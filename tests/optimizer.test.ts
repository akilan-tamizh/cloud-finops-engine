jest.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) =>
      (globalThis as any).__optimizerMocks.ec2Send(...args),
  })),
  DescribeInstancesCommand: jest.fn().mockImplementation(
    (input) => ({ input })
  ),
  StopInstancesCommand: jest.fn().mockImplementation(
    (input) => ({ input })
  ),
}));

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) =>
      (globalThis as any).__optimizerMocks.dynamoSend(...args),
  })),
  PutItemCommand: jest.fn().mockImplementation(
    (input) => ({ input })
  ),
}));

jest.mock("@aws-sdk/client-sns", () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) =>
      (globalThis as any).__optimizerMocks.snsSend(...args),
  })),
  PublishCommand: jest.fn().mockImplementation(
    (input) => ({ input })
  ),
}));

const mocks = {
  ec2Send: jest.fn(),
  dynamoSend: jest.fn(),
  snsSend: jest.fn(),
};

(globalThis as any).__optimizerMocks = mocks;

process.env.FINOPS_TABLE_NAME = "TestFinOpsIssues";
process.env.SNS_TOPIC_ARN =
  "arn:aws:sns:ap-southeast-2:123456789012:FinOpsTest";

const { handler } = require("../backend/optimizer/index");

describe("Cloud FinOps Optimizer", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mocks.ec2Send.mockImplementation(async (command: any) => {
      if (command.input?.Filters) {
        return {
          Reservations: [
            {
              Instances: [{ InstanceId: "i-test-finops-001" }],
            },
          ],
        };
      }

      return {};
    });

    mocks.dynamoSend.mockResolvedValue({});
    mocks.snsSend.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    delete (globalThis as any).__optimizerMocks;
  });

  test("does not stop instances during working hours", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-13T10:00:00Z"));

    await handler();

    expect(mocks.ec2Send).not.toHaveBeenCalled();
    expect(mocks.dynamoSend).not.toHaveBeenCalled();
    expect(mocks.snsSend).not.toHaveBeenCalled();
  });

  test("checks running instances outside working hours", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-13T20:00:00Z"));

    await handler();

    expect(mocks.ec2Send).toHaveBeenCalledTimes(2);

    const describeCommand = mocks.ec2Send.mock.calls[0][0];

    expect(describeCommand.input.Filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Name: "instance-state-name",
          Values: ["running"],
        }),
        expect.objectContaining({
          Name: "tag:FinOpsAutoStop",
          Values: ["true"],
        }),
      ])
    );
  });

  test("stops an eligible instance and records an audit entry", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-13T20:00:00Z"));

    await handler();

    const stopCommand = mocks.ec2Send.mock.calls.find(
      (call: any[]) =>
        Array.isArray(call[0].input?.InstanceIds)
    )?.[0];

    expect(stopCommand).toBeDefined();
    expect(stopCommand.input.InstanceIds).toEqual([
      "i-test-finops-001",
    ]);

    expect(mocks.dynamoSend).toHaveBeenCalledTimes(1);

    const auditCommand = mocks.dynamoSend.mock.calls[0][0];

    expect(auditCommand.input.TableName).toBe(
      "TestFinOpsIssues"
    );
    expect(auditCommand.input.Item.type.S).toBe(
      "EC2_AUTO_STOP"
    );
  });

  test("sends an SNS notification after a successful stop", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-13T20:00:00Z"));

    await handler();

    expect(mocks.snsSend).toHaveBeenCalledTimes(1);
  });
});
