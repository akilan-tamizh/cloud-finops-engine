
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";

import {
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

import {
  SNSClient,
  PublishCommand,
} from "@aws-sdk/client-sns";

const costExplorer = new CostExplorerClient({
  region: "us-east-1",
});

const dynamodb = new DynamoDBClient({});
const sns = new SNSClient({});

const TABLE_NAME = process.env.FINOPS_TABLE_NAME;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

const DEMO_MODE = false;
const ANOMALY_THRESHOLD = 20;

type CostResult =
  | { available: true; cost: number }
  | { available: false; reason: string };

type Trend =
  | "INCREASING"
  | "DECREASING"
  | "STABLE"
  | "UNAVAILABLE";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getCurrentMonthStart(): Date {
  const now = new Date();

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
}

function getPreviousMonthStart(): Date {
  const currentMonthStart = getCurrentMonthStart();

  return new Date(
    Date.UTC(
      currentMonthStart.getUTCFullYear(),
      currentMonthStart.getUTCMonth() - 1,
      1
    )
  );
}

function isDataUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const e = error as {
    name?: string;
    message?: string;
    __type?: string;
  };

  return (
    e.name === "DataUnavailableException" ||
    e.__type?.includes("DataUnavailableException") === true ||
    e.message?.includes("Data is not available") === true
  );
}

/**
 * Retrieves actual AWS usage costs before credits are applied.
 *
 * RECORD_TYPE = Usage excludes credit records, allowing the
 * dashboard to show usage charges even when credits offset them.
 *
 * This is usage cost, NOT the final amount owed on the AWS bill.
 */
async function getCost(
  startDate: string,
  endDate: string
): Promise<number> {
  const response = await costExplorer.send(
    new GetCostAndUsageCommand({
      TimePeriod: {
        Start: startDate,
        End: endDate,
      },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      Filter: {
        Dimensions: {
          Key: "RECORD_TYPE",
          Values: ["Usage"],
        },
      },
    })
  );

  const results = response.ResultsByTime ?? [];

  let total = 0;

  for (const result of results) {
    const amount = result.Total?.UnblendedCost?.Amount;

    if (amount === undefined || amount === null) {
      continue;
    }

    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount)) {
      throw new Error(
        `Cost Explorer returned an invalid amount: ${amount}`
      );
    }

    total += parsedAmount;
  }

  return Number(total.toFixed(2));
}

async function retrieveCost(
  startDate: string,
  endDate: string
): Promise<CostResult> {
  try {
    const cost = await getCost(startDate, endDate);

    return {
      available: true,
      cost,
    };
  } catch (error) {
    console.error(
      `Cost Explorer request failed for ${startDate} to ${endDate}:`,
      error
    );

    if (isDataUnavailable(error)) {
      return {
        available: false,
        reason: "COST_DATA_UNAVAILABLE",
      };
    }

    throw error;
  }
}

export const handler = async () => {
  console.log("Cloud FinOps Cost Analyzer started.");
  console.log("Data source: AWS Cost Explorer.");
  console.log("Cost metric: AWS usage charges before credits.");

  if (!TABLE_NAME) {
    console.error(
      "FINOPS_TABLE_NAME environment variable is missing."
    );

    return {
      statusCode: 500,
      body: JSON.stringify({
        status: "CONFIGURATION_ERROR",
        message: "Cost analysis table is not configured.",
      }),
    };
  }

  const now = new Date();

  const currentMonthStart = getCurrentMonthStart();
  const currentPeriodStart = formatDate(currentMonthStart);

  // Cost Explorer end dates are exclusive.
  const currentPeriodEnd = formatDate(
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      )
    )
  );

  const previousMonthStart = getPreviousMonthStart();
  const previousPeriodStart = formatDate(previousMonthStart);

  // Compare the same number of calendar days in both months.
  const previousMonthDays = new Date(
    Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();

  const comparisonDays = Math.min(
    now.getUTCDate(),
    previousMonthDays
  );

  const previousPeriodEnd = formatDate(
    new Date(
      Date.UTC(
        previousMonthStart.getUTCFullYear(),
        previousMonthStart.getUTCMonth(),
        comparisonDays + 1
      )
    )
  );

  console.log(
    `Current period: ${currentPeriodStart} -> ${currentPeriodEnd}`
  );

  console.log(
    `Previous comparison period: ${previousPeriodStart} -> ${previousPeriodEnd}`
  );

  // Retrieve current-month usage cost.
  const currentResult = await retrieveCost(
    currentPeriodStart,
    currentPeriodEnd
  );

  if (!currentResult.available) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        status: "COST_DATA_UNAVAILABLE",
        message:
          "Current-period Cost Explorer data is not available yet.",
        currentPeriodStart,
        currentPeriodEnd,
        demoMode: DEMO_MODE,
        dataSource: "AWS_COST_EXPLORER",
        costMetric: "USAGE_COST_BEFORE_CREDITS",
      }),
    };
  }

  const currentCost = currentResult.cost;

  // Retrieve previous-month usage cost for comparison.
  const previousResult = await retrieveCost(
    previousPeriodStart,
    previousPeriodEnd
  );

  const comparisonAvailable = previousResult.available;

  const previousCost = comparisonAvailable
    ? previousResult.cost
    : null;

  let percentageChange: number | null = null;
  let trend: Trend = "UNAVAILABLE";

  if (previousCost !== null) {
    if (previousCost === 0) {
      percentageChange = currentCost > 0 ? 100 : 0;
    } else {
      percentageChange =
        ((currentCost - previousCost) / Math.abs(previousCost)) *
        100;
    }

    percentageChange = Number(percentageChange.toFixed(2));

    if (percentageChange > 5) {
      trend = "INCREASING";
    } else if (percentageChange < -5) {
      trend = "DECREASING";
    } else {
      trend = "STABLE";
    }
  }

  // Do not report an anomaly when comparison data is unavailable.
  const anomalyDetected =
    comparisonAvailable &&
    percentageChange !== null &&
    Math.abs(percentageChange) >= ANOMALY_THRESHOLD;

  const comparisonStatus = comparisonAvailable
    ? "AVAILABLE"
    : "HISTORICAL_DATA_UNAVAILABLE";

  const analysisId = `cost-${Date.now()}`;
  const analyzedAt = new Date().toISOString();

  const item: Record<string, any> = {
    issueId: {
      S: analysisId,
    },

    type: {
      S: "COST_ANALYSIS",
    },

    currentPeriodStart: {
      S: currentPeriodStart,
    },

    currentPeriodEnd: {
      S: currentPeriodEnd,
    },

    currentCost: {
      N: currentCost.toString(),
    },

    previousPeriodStart: {
      S: previousPeriodStart,
    },

    previousPeriodEnd: {
      S: previousPeriodEnd,
    },

    previousCost:
      previousCost === null
        ? { NULL: true }
        : { N: previousCost.toString() },

    percentageChange:
      percentageChange === null
        ? { NULL: true }
        : { N: percentageChange.toString() },

    trend: {
      S: trend,
    },

    anomalyDetected: {
      BOOL: anomalyDetected,
    },

    anomalyThreshold: {
      N: ANOMALY_THRESHOLD.toString(),
    },

    comparisonAvailable: {
      BOOL: comparisonAvailable,
    },

    comparisonStatus: {
      S: comparisonStatus,
    },

    currency: {
      S: "USD",
    },

    demoMode: {
      BOOL: DEMO_MODE,
    },

    dataSource: {
      S: "AWS_COST_EXPLORER",
    },

    costMetric: {
      S: "USAGE_COST_BEFORE_CREDITS",
    },

    analyzedAt: {
      S: analyzedAt,
    },
  };

  await dynamodb.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  console.log(
    `Cost analysis saved to DynamoDB: ${analysisId}`
  );

  if (
    anomalyDetected &&
    SNS_TOPIC_ARN &&
    previousCost !== null
  ) {
    await sns.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: "Cloud FinOps Cost Anomaly Detected",
        Message: [
          "Cloud FinOps detected a significant usage-cost change.",
          "",
          `Current usage cost (before credits): $${currentCost.toFixed(2)}`,
          `Previous usage cost (before credits): $${previousCost.toFixed(2)}`,
          `Percentage change: ${percentageChange}%`,
          `Trend: ${trend}`,
          `Anomaly threshold: ${ANOMALY_THRESHOLD}%`,
          "Data source: AWS Cost Explorer",
          "Metric: Usage cost before credits",
          `Analysis ID: ${analysisId}`,
        ].join("\n"),
      })
    );

    console.log("SNS anomaly notification sent.");
  } else if (!comparisonAvailable) {
    console.log(
      "Historical data unavailable; comparison and anomaly alert skipped."
    );
  }

  const result = {
    analysisId,

    status: comparisonAvailable
      ? "SUCCESS"
      : "PARTIAL_DATA",

    currentPeriodStart,
    currentPeriodEnd,

    previousPeriodStart,
    previousPeriodEnd,

    currentCost,
    previousCost,

    percentageChange,
    trend,

    anomalyDetected,
    anomalyThreshold: ANOMALY_THRESHOLD,

    comparisonAvailable,
    comparisonStatus,

    currency: "USD",
    demoMode: DEMO_MODE,

    dataSource: "AWS_COST_EXPLORER",
    costMetric: "USAGE_COST_BEFORE_CREDITS",

    analyzedAt,
  };

  console.log(
    "Cost analysis result:",
    JSON.stringify(result, null, 2)
  );

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};
