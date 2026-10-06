import {
  EC2Client,
  DescribeInstancesCommand,
  StopInstancesCommand,
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

const TABLE_NAME = process.env.FINOPS_TABLE_NAME!;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;

// Normal working-hours protection.
// These hours are interpreted as UTC because
// the Lambda uses getUTCHours() below.
//
// 09:00 UTC = working hours start
// 18:00 UTC = working hours end
//
// During working hours, tagged EC2 instances
// will NOT be automatically stopped.
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

export const handler = async () => {
  const now = new Date();
  const currentHour = now.getUTCHours();

  console.log("Cloud FinOps Optimizer started.");
  console.log(`Current UTC hour: ${currentHour}`);
  console.log(
    `Working hours configured: ${WORK_START_HOUR}:00 - ${WORK_END_HOUR}:00 UTC`
  );

  // Working-hours protection.
  // If the current UTC time is within working hours,
  // do not automatically stop any EC2 instances.
  if (currentHour >= WORK_START_HOUR && currentHour < WORK_END_HOUR) {
    console.log("Within working hours. No instances were stopped.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Within working hours. No instances were stopped.",
        currentHour,
      }),
    };
  }

  console.log(
    "Outside working hours. Searching for FinOpsAutoStop=true instances..."
  );

  const response = await ec2.send(
    new DescribeInstancesCommand({
      Filters: [
        {
          Name: "instance-state-name",
          Values: ["running"],
        },
        {
          Name: "tag:FinOpsAutoStop",
          Values: ["true"],
        },
      ],
    })
  );

  const instances =
    response.Reservations?.flatMap(
      (reservation) => reservation.Instances || []
    ) || [];

  console.log(`Eligible instances found: ${instances.length}`);

  if (instances.length === 0) {
    console.log("No eligible FinOpsAutoStop instances found.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "No eligible FinOpsAutoStop instances found.",
        stoppedInstances: 0,
      }),
    };
  }

  const stoppedIds: string[] = [];

  for (const instance of instances) {
    if (!instance.InstanceId) {
      continue;
    }

    console.log(`Stopping EC2 instance: ${instance.InstanceId}`);

    await ec2.send(
      new StopInstancesCommand({
        InstanceIds: [instance.InstanceId],
      })
    );

    stoppedIds.push(instance.InstanceId);

    await dynamodb.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: {
          issueId: {
            S: `optimization-${Date.now()}-${instance.InstanceId}`,
          },
          type: {
            S: "EC2_AUTO_STOP",
          },
          resourceId: {
            S: instance.InstanceId,
          },
          status: {
            S: "COMPLETED",
          },
          action: {
            S: "STOP_INSTANCE",
          },
          reason: {
            S: "Tagged FinOpsAutoStop=true and outside working hours.",
          },
          executedAt: {
            S: new Date().toISOString(),
          },
        },
      })
    );

    console.log(
      `Optimization record saved to DynamoDB for ${instance.InstanceId}`
    );
  }

  if (stoppedIds.length > 0 && SNS_TOPIC_ARN) {
    await sns.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: "Cloud FinOps EC2 Optimization",
        Message: `
Cloud FinOps automatically stopped
${stoppedIds.length} EC2 instance(s).

Instances:
${stoppedIds.join("\n")}

Reason:
FinOpsAutoStop=true and outside working hours.

This action was performed automatically by the
Cloud FinOps Optimization Engine.
        `.trim(),
      })
    );

    console.log("SNS optimization notification sent.");
  }

  console.log(
    `Optimization completed. Stopped ${stoppedIds.length} instance(s).`
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Optimization completed.",
      stoppedInstances: stoppedIds.length,
      instanceIds: stoppedIds,
    }),
  };
};