import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
} from "@aws-sdk/client-ec2";

import {
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

import {
  SNSClient,
  PublishCommand,
} from "@aws-sdk/client-sns";


const ec2 = new EC2Client({});

const dynamodb = new DynamoDBClient({});

const sns = new SNSClient({});


const TABLE_NAME =
  process.env.FINOPS_TABLE_NAME!;

const SNS_TOPIC_ARN =
  process.env.SNS_TOPIC_ARN!;


// ============================================================
// ESTIMATED MONTHLY COSTS
// These are conservative demo estimates.
// ============================================================

const EBS_MONTHLY_COST = 8;

const ELASTIC_IP_MONTHLY_COST = 3.65;

const STOPPED_EC2_MONTHLY_COST = 5;


// ============================================================
// LAMBDA HANDLER
// ============================================================

export const handler = async () => {

  const scannedAt =
    new Date().toISOString();

  const issueId =
    `scan-${Date.now()}`;


  // ==========================================================
  // 1. EC2 INSTANCES
  // ==========================================================

  const instancesResponse =
    await ec2.send(
      new DescribeInstancesCommand({})
    );


  const instances =
    instancesResponse.Reservations
      ?.flatMap(
        reservation =>
          reservation.Instances || []
      ) || [];


  const runningInstances =
    instances.filter(
      instance =>
        instance.State?.Name === "running"
    );


  const stoppedInstances =
    instances.filter(
      instance =>
        instance.State?.Name === "stopped"
    );


  // ==========================================================
  // 2. EBS VOLUMES
  // ==========================================================

  const volumesResponse =
    await ec2.send(
      new DescribeVolumesCommand({})
    );


  const volumes =
    volumesResponse.Volumes || [];


  const unattachedVolumes =
    volumes.filter(
      volume =>
        !volume.Attachments ||
        volume.Attachments.length === 0
    );


  // ==========================================================
  // 3. ELASTIC IPs
  // ==========================================================

  const addressesResponse =
    await ec2.send(
      new DescribeAddressesCommand({})
    );


  const addresses =
    addressesResponse.Addresses || [];


  const unusedAddresses =
    addresses.filter(
      address =>
        !address.AssociationId
    );


  // ==========================================================
  // 4. ESTIMATE SAVINGS
  // ==========================================================

  const ebsSavings =
    unattachedVolumes.length *
    EBS_MONTHLY_COST;


  const ipSavings =
    unusedAddresses.length *
    ELASTIC_IP_MONTHLY_COST;


  const stoppedEc2Savings =
    stoppedInstances.length *
    STOPPED_EC2_MONTHLY_COST;


  const estimatedMonthlySavings =
    ebsSavings +
    ipSavings +
    stoppedEc2Savings;


  // ==========================================================
  // 5. CREATE ISSUES
  // ==========================================================

  const issues: any[] = [];


  for (
    const volume
    of unattachedVolumes
  ) {

    issues.push({
      issueId:
        `ebs-${volume.VolumeId}`,

      type:
        "UNATTACHED_EBS",

      resourceId:
        volume.VolumeId || "unknown",

      severity:
        "MEDIUM",

      description:
        "EBS volume is not attached to any EC2 instance.",

      recommendation:
        "Review and delete the unused EBS volume if it is no longer required.",

      estimatedMonthlySavings:
        EBS_MONTHLY_COST,

      status:
        "OPEN",

      detectedAt:
        scannedAt,
    });
  }


  for (
    const address
    of unusedAddresses
  ) {

    issues.push({
      issueId:
        `eip-${address.AllocationId}`,

      type:
        "UNUSED_ELASTIC_IP",

      resourceId:
        address.AllocationId || "unknown",

      severity:
        "LOW",

      description:
        "Elastic IP address is allocated but not associated with an EC2 instance.",

      recommendation:
        "Release the unused Elastic IP address if it is no longer required.",

      estimatedMonthlySavings:
        ELASTIC_IP_MONTHLY_COST,

      status:
        "OPEN",

      detectedAt:
        scannedAt,
    });
  }


  for (
    const instance
    of stoppedInstances
  ) {

    issues.push({
      issueId:
        `ec2-${instance.InstanceId}`,

      type:
        "STOPPED_EC2",

      resourceId:
        instance.InstanceId || "unknown",

      severity:
        "LOW",

      description:
        "EC2 instance is currently stopped and may represent unused capacity.",

      recommendation:
        "Review the instance and terminate it if it is no longer required, or automate scheduled cleanup.",

      estimatedMonthlySavings:
        STOPPED_EC2_MONTHLY_COST,

      status:
        "OPEN",

      detectedAt:
        scannedAt,
    });
  }


  // ==========================================================
  // 6. SAVE SCAN SUMMARY
  // ==========================================================

  await dynamodb.send(
    new PutItemCommand({
      TableName:
        TABLE_NAME,

      Item: {

        issueId: {
          S: issueId,
        },

        type: {
          S: "RESOURCE_SCAN",
        },

        ec2Instances: {
          N:
            instances.length.toString(),
        },

        stoppedInstances: {
          N:
            stoppedInstances.length.toString(),
        },

        runningInstances: {
          N:
            runningInstances.length.toString(),
        },

        ebsVolumes: {
          N:
            volumes.length.toString(),
        },

        unattachedEbsVolumes: {
          N:
            unattachedVolumes.length.toString(),
        },

        elasticIps: {
          N:
            addresses.length.toString(),
        },

        unusedElasticIps: {
          N:
            unusedAddresses.length.toString(),
        },

        estimatedMonthlySavings: {
          N:
            estimatedMonthlySavings.toString(),
        },

        scannedAt: {
          S:
            scannedAt,
        },
      },
    })
  );


  // ==========================================================
  // 7. SAVE INDIVIDUAL ISSUES
  // ==========================================================

  for (
    const issue
    of issues
  ) {

    await dynamodb.send(
      new PutItemCommand({

        TableName:
          TABLE_NAME,

        Item: {

          issueId: {
            S:
              issue.issueId,
          },

          type: {
            S:
              issue.type,
          },

          resourceId: {
            S:
              issue.resourceId,
          },

          severity: {
            S:
              issue.severity,
          },

          description: {
            S:
              issue.description,
          },

          recommendation: {
            S:
              issue.recommendation,
          },

          estimatedMonthlySavings: {
            N:
              issue.estimatedMonthlySavings.toString(),
          },

          status: {
            S:
              issue.status,
          },

          detectedAt: {
            S:
              issue.detectedAt,
          },
        },
      })
    );
  }


  // ==========================================================
  // 8. SNS ALERT
  // ==========================================================

  if (
    issues.length > 0 &&
    SNS_TOPIC_ARN
  ) {

    await sns.send(
      new PublishCommand({

        TopicArn:
          SNS_TOPIC_ARN,

        Subject:
          "Cloud FinOps Optimization Alert",

        Message:
          `
Cloud FinOps Engine detected
${issues.length} optimization issue(s).

Estimated monthly savings:
$${estimatedMonthlySavings.toFixed(2)}

Unattached EBS:
${unattachedVolumes.length}

Unused Elastic IPs:
${unusedAddresses.length}

Stopped EC2 instances:
${stoppedInstances.length}

Please review the Cloud FinOps dashboard.
          `.trim(),
      })
    );
  }


  // ==========================================================
  // 9. RESPONSE
  // ==========================================================

  return {

    statusCode:
      200,

    body:
      JSON.stringify({

        issueId,

        ec2Instances:
          instances.length,

        runningInstances:
          runningInstances.length,

        stoppedInstances:
          stoppedInstances.length,

        ebsVolumes:
          volumes.length,

        unattachedEbsVolumes:
          unattachedVolumes.length,

        elasticIps:
          addresses.length,

        unusedElasticIps:
          unusedAddresses.length,

        issueCount:
          issues.length,

        estimatedMonthlySavings,

        scannedAt,

      }),
  };
};