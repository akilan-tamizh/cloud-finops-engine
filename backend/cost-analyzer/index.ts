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

export const handler = async () => {
  console.log("FinOps Cost Analyzer started");

  const tableName = process.env.FINOPS_TABLE_NAME;
  const snsTopicArn = process.env.SNS_TOPIC_ARN;

  if (!tableName) {
    throw new Error(
      "FINOPS_TABLE_NAME environment variable is missing"
    );
  }

  if (!snsTopicArn) {
    throw new Error(
      "SNS_TOPIC_ARN environment variable is missing"
    );
  }

  const now = new Date();

  const currentMonthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );

  const previousMonthStart = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );

  const formatDate = (date: Date) =>
    date.toISOString().split("T")[0];

  const currentStart = formatDate(
    currentMonthStart
  );

  const previousStart = formatDate(
    previousMonthStart
  );

  const endDate = new Date(now);

  endDate.setDate(
    endDate.getDate() + 1
  );

  const end = formatDate(endDate);

  console.log(
    `Current period: ${currentStart} to ${end}`
  );

  console.log(
    `Previous period: ${previousStart} to ${currentStart}`
  );

  // =====================================================
  // CURRENT COST
  // =====================================================

  let currentAmount = 0;

  try {
    const response =
      await costExplorer.send(
        new GetCostAndUsageCommand({
          TimePeriod: {
            Start: currentStart,
            End: end,
          },
          Granularity: "MONTHLY",
          Metrics: ["UnblendedCost"],
        })
      );

    currentAmount = Number(
      response.ResultsByTime?.[0]
        ?.Total
        ?.UnblendedCost
        ?.Amount ?? "0"
    );

  } catch (error) {
    console.log(
      "Current Cost Explorer data is unavailable."
    );

    console.log(error);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:
          "Cost Explorer data is not available yet.",
        currentCost: 0,
      }),
    };
  }

  // =====================================================
  // PREVIOUS COST
  // =====================================================

  let previousAmount = 0;

  try {
    const response =
      await costExplorer.send(
        new GetCostAndUsageCommand({
          TimePeriod: {
            Start: previousStart,
            End: currentStart,
          },
          Granularity: "MONTHLY",
          Metrics: ["UnblendedCost"],
        })
      );

    previousAmount = Number(
      response.ResultsByTime?.[0]
        ?.Total
        ?.UnblendedCost
        ?.Amount ?? "0"
    );

  } catch (error) {
    console.log(
      "Previous Cost Explorer data is unavailable."
    );

    console.log(
      "Continuing with previous cost = $0"
    );

    previousAmount = 0;
  }

  // =====================================================
  // TREND
  // =====================================================

  let percentageChange = 0;

  if (previousAmount > 0) {
    percentageChange =
      (
        (currentAmount - previousAmount) /
        previousAmount
      ) * 100;
  } else if (currentAmount > 0) {
    percentageChange = 100;
  }

  const anomalyThreshold = 20;

  const anomalyDetected =
    percentageChange >= anomalyThreshold;

  const trend =
    currentAmount > previousAmount
      ? "INCREASING"
      : currentAmount < previousAmount
        ? "DECREASING"
        : "STABLE";

  console.log(
    `Current cost: $${currentAmount.toFixed(2)}`
  );

  console.log(
    `Previous cost: $${previousAmount.toFixed(2)}`
  );

  console.log(
    `Change: ${percentageChange.toFixed(2)}%`
  );

  console.log(
    `Trend: ${trend}`
  );

  console.log(
    `Anomaly: ${anomalyDetected}`
  );

  // =====================================================
  // SAVE TO DYNAMODB
  // =====================================================

  const analysisId =
    `cost-${Date.now()}`;

  const analyzedAt =
    new Date().toISOString();

  await dynamodb.send(
    new PutItemCommand({
      TableName: tableName,

      Item: {
        issueId: {
          S: analysisId,
        },

        type: {
          S: "COST_ANALYSIS",
        },

        currentPeriodStart: {
          S: currentStart,
        },

        currentPeriodEnd: {
          S: end,
        },

        previousPeriodStart: {
          S: previousStart,
        },

        previousPeriodEnd: {
          S: currentStart,
        },

        currentCost: {
          N: currentAmount.toFixed(2),
        },

        previousCost: {
          N: previousAmount.toFixed(2),
        },

        percentageChange: {
          N: percentageChange.toFixed(2),
        },

        trend: {
          S: trend,
        },

        anomalyDetected: {
          BOOL: anomalyDetected,
        },

        anomalyThreshold: {
          N: anomalyThreshold.toString(),
        },

        currency: {
          S: "USD",
        },

        analyzedAt: {
          S: analyzedAt,
        },
      },
    })
  );

  // =====================================================
  // SNS ALERT
  // =====================================================

  if (anomalyDetected) {

    const message = [
      "AWS FinOps Cost Anomaly Alert",
      "",
      `Current cost: $${currentAmount.toFixed(2)}`,
      `Previous cost: $${previousAmount.toFixed(2)}`,
      `Cost increase: ${percentageChange.toFixed(2)}%`,
      `Threshold: ${anomalyThreshold}%`,
      "",
      "An unusual increase in AWS spending was detected.",
      "Please review the AWS resources and cost breakdown.",
    ].join("\n");

    await sns.send(
      new PublishCommand({
        TopicArn: snsTopicArn,
        Subject:
          "AWS FinOps Cost Anomaly Detected",
        Message: message,
      })
    );

    console.log(
      "SNS anomaly alert sent"
    );

  } else {

    console.log(
      "No cost anomaly detected."
    );
  }

  // =====================================================
  // RESPONSE
  // =====================================================

  return {
    statusCode: 200,

    body: JSON.stringify({
      analysisId,

      currentPeriodStart:
        currentStart,

      currentPeriodEnd:
        end,

      previousPeriodStart:
        previousStart,

      previousPeriodEnd:
        currentStart,

      currentCost:
        currentAmount,

      previousCost:
        previousAmount,

      percentageChange:
        Number(
          percentageChange.toFixed(2)
        ),

      trend,

      anomalyDetected,

      anomalyThreshold,

      currency: "USD",

      analyzedAt,
    }),
  };
};