import {
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});

export const handler = async () => {
  console.log("FinOps Dashboard API started");

  const tableName = process.env.FINOPS_TABLE_NAME;

  if (!tableName) {
    throw new Error(
      "FINOPS_TABLE_NAME environment variable is missing"
    );
  }

  // =====================================================
  // READ ALL FINOPS DATA
  // =====================================================

  const response = await dynamodb.send(
    new ScanCommand({
      TableName: tableName,
    })
  );

  const items = response.Items ?? [];

  // =====================================================
  // CONVERT DYNAMODB FORMAT TO NORMAL JSON
  // =====================================================

  const records = items.map((item) => {
    const record: Record<string, any> = {};

    for (const [key, value] of Object.entries(item)) {
      if ("S" in value && value.S !== undefined) {
        record[key] = value.S;
      } else if (
        "N" in value &&
        value.N !== undefined
      ) {
        record[key] = Number(value.N);
      } else if (
        "BOOL" in value &&
        value.BOOL !== undefined
      ) {
        record[key] = value.BOOL;
      }
    }

    return record;
  });

  console.log(`Records found: ${records.length}`);

  // =====================================================
  // RESOURCE SCANS
  // =====================================================

  const scans = records.filter(
    (item) => item.type === "RESOURCE_SCAN"
  );

  // =====================================================
  // COST ANALYSIS
  // =====================================================

  const costAnalyses = records.filter(
    (item) => item.type === "COST_ANALYSIS"
  );

  // =====================================================
  // FINOPS ISSUES
  // =====================================================

  const issues = records.filter(
    (item) =>
      item.type === "UNATTACHED_EBS" ||
      item.type === "UNUSED_ELASTIC_IP" ||
      item.type === "STOPPED_EC2"
  );

  // =====================================================
  // FIND LATEST RESOURCE SCAN
  // =====================================================

  const latestScan =
    scans
      .sort(
        (a, b) =>
          new Date(b.scannedAt).getTime() -
          new Date(a.scannedAt).getTime()
      )[0] ?? null;

  // =====================================================
  // FIND LATEST COST ANALYSIS
  // =====================================================

  const latestCostAnalysis =
    costAnalyses
      .sort(
        (a, b) =>
          new Date(b.analyzedAt).getTime() -
          new Date(a.analyzedAt).getTime()
      )[0] ?? null;

  // =====================================================
  // CALCULATE ESTIMATED SAVINGS
  // =====================================================
  //
  // Resource Scanner stores the field as:
  //
  // estimatedMonthlySavings
  //
  // The previous Dashboard API incorrectly used:
  //
  // estimatedMonthlySaving
  //
  // which caused the dashboard summary to show $0.00.
  //
  // We support both names here for compatibility with
  // any older DynamoDB records.
  // =====================================================

  const estimatedMonthlySavings = issues.reduce(
    (total, issue) => {
      const savings =
        issue.estimatedMonthlySavings ??
        issue.estimatedMonthlySaving ??
        0;

      return total + Number(savings);
    },
    0
  );

  console.log(
    `Estimated monthly savings: $${estimatedMonthlySavings.toFixed(2)}`
  );

  // =====================================================
  // DASHBOARD SUMMARY
  // =====================================================

  const summary = {
    currentCost:
      latestCostAnalysis?.currentCost ?? 0,

    previousCost:
      latestCostAnalysis?.previousCost ?? 0,

    percentageChange:
      latestCostAnalysis?.percentageChange ?? 0,

    trend:
      latestCostAnalysis?.trend ?? "UNKNOWN",

    anomalyDetected:
      latestCostAnalysis?.anomalyDetected ?? false,

    estimatedMonthlySavings:
      Number(
        estimatedMonthlySavings.toFixed(2)
      ),

    totalIssues:
      issues.length,
  };

  // =====================================================
  // RESOURCE SUMMARY
  // =====================================================

  const resources = {
    ec2Instances:
      latestScan?.ec2Instances ?? 0,

    stoppedInstances:
      latestScan?.stoppedInstances ?? 0,

    ebsVolumes:
      latestScan?.ebsVolumes ?? 0,

    unattachedEbsVolumes:
      latestScan?.unattachedEbsVolumes ?? 0,

    elasticIps:
      latestScan?.elasticIps ?? 0,

    unusedElasticIps:
      latestScan?.unusedElasticIps ?? 0,
  };

  // =====================================================
  // FINAL DASHBOARD RESPONSE
  // =====================================================

  const dashboardData = {
    summary,

    resources,

    latestScan,

    latestCostAnalysis,

    issues,
  };

  console.log(
    "Dashboard response:",
    JSON.stringify(
      dashboardData,
      null,
      2
    )
  );

  // =====================================================
  // API RESPONSE
  // =====================================================

  return {
    statusCode: 200,

    headers: {
      "Content-Type":
        "application/json",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "Content-Type",

      "Access-Control-Allow-Methods":
        "GET,OPTIONS",
    },

    body:
      JSON.stringify(
        dashboardData
      ),
  };
};