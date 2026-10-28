
jest.mock("@aws-sdk/client-cost-explorer", () => ({
  CostExplorerClient: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) =>
      (globalThis as any).__finopsMocks.costSend(...args),
  })),
  GetCostAndUsageCommand: jest.fn().mockImplementation(
    (input) => ({ input })
  ),
}));

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) =>
      (globalThis as any).__finopsMocks.dynamoSend(...args),
  })),
  PutItemCommand: jest.fn().mockImplementation(
    (input) => ({ input })
  ),
}));

jest.mock("@aws-sdk/client-sns", () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) =>
      (globalThis as any).__finopsMocks.snsSend(...args),
  })),
  PublishCommand: jest.fn().mockImplementation(
    (input) => ({ input })
  ),
}));

const mocks = {
  costSend: jest.fn(),
  dynamoSend: jest.fn(),
  snsSend: jest.fn(),
};

(globalThis as any).__finopsMocks = mocks;

let handler: () => Promise<any>;

function costResponse(amount: string) {
  return {
    ResultsByTime: [
      {
        Total: {
          UnblendedCost: {
            Amount: amount,
            Unit: "USD",
          },
        },
      },
    ],
  };
}

function unavailableError() {
  return Object.assign(
    new Error(
      "Data is not available. Please try to adjust the time period."
    ),
    { name: "DataUnavailableException" }
  );
}

describe("Cloud FinOps Cost Analyzer — real data only", () => {
  beforeAll(() => {
    process.env.SNS_TOPIC_ARN =
      "arn:aws:sns:us-east-1:123456789012:finops-test";

    process.env.FINOPS_TABLE_NAME = "FinOpsIssues";

    jest.isolateModules(() => {
      handler = require("../backend/cost-analyzer/index").handler;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mocks.costSend
      .mockResolvedValueOnce(costResponse("25.00"))
      .mockResolvedValueOnce(costResponse("20.00"));

    mocks.dynamoSend.mockResolvedValue({});
    mocks.snsSend.mockResolvedValue({});
  });

  afterAll(() => {
    delete (globalThis as any).__finopsMocks;
    delete process.env.SNS_TOPIC_ARN;
    delete process.env.FINOPS_TABLE_NAME;
  });

  test("uses Cost Explorer amounts without demo fallback", async () => {
    const response = await handler();
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.status).toBe("SUCCESS");
    expect(result.currentCost).toBe(25);
    expect(result.previousCost).toBe(20);
    expect(result.percentageChange).toBe(25);
    expect(result.trend).toBe("INCREASING");
    expect(result.anomalyDetected).toBe(true);
    expect(result.demoMode).toBe(false);
    expect(result.dataSource).toBe("AWS_COST_EXPLORER");
    expect(mocks.costSend).toHaveBeenCalledTimes(2);
  });

  test("stores real-data metadata and costs in DynamoDB", async () => {
    await handler();

    expect(mocks.dynamoSend).toHaveBeenCalledTimes(1);

    const item = mocks.dynamoSend.mock.calls[0][0].input.Item;

    expect(item.type.S).toBe("COST_ANALYSIS");
    expect(Number(item.currentCost.N)).toBe(25);
    expect(Number(item.previousCost.N)).toBe(20);
    expect(item.demoMode.BOOL).toBe(false);
    expect(item.dataSource.S).toBe("AWS_COST_EXPLORER");
    expect(item.currency.S).toBe("USD");
    expect(item.comparisonAvailable.BOOL).toBe(true);
  });

  test("preserves genuine zero-cost results without demo values", async () => {
    mocks.costSend
      .mockReset()
      .mockResolvedValueOnce(costResponse("0"))
      .mockResolvedValueOnce(costResponse("0"));

    const response = await handler();
    const result = JSON.parse(response.body);

    expect(result.currentCost).toBe(0);
    expect(result.previousCost).toBe(0);
    expect(result.demoMode).toBe(false);
    expect(result.dataSource).toBe("AWS_COST_EXPLORER");
    expect(result.percentageChange).toBe(0);
    expect(result.anomalyDetected).toBe(false);
  });

  test("returns unavailable status when current-period data is unavailable", async () => {
    mocks.costSend
      .mockReset()
      .mockRejectedValueOnce(unavailableError());

    const response = await handler();
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(503);
    expect(result.status).toBe("COST_DATA_UNAVAILABLE");
    expect(result.demoMode).toBe(false);
    expect(result.dataSource).toBe("AWS_COST_EXPLORER");
    expect(mocks.dynamoSend).not.toHaveBeenCalled();
    expect(mocks.snsSend).not.toHaveBeenCalled();
  });

  test("saves current costs but skips comparison when historical data is unavailable", async () => {
    mocks.costSend
      .mockReset()
      .mockResolvedValueOnce(costResponse("0"))
      .mockRejectedValueOnce(unavailableError());

    const response = await handler();
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.status).toBe("PARTIAL_DATA");
    expect(result.currentCost).toBe(0);
    expect(result.previousCost).toBeNull();
    expect(result.percentageChange).toBeNull();
    expect(result.trend).toBe("UNAVAILABLE");
    expect(result.comparisonAvailable).toBe(false);
    expect(result.comparisonStatus).toBe(
      "HISTORICAL_DATA_UNAVAILABLE"
    );
    expect(result.anomalyDetected).toBe(false);
    expect(result.demoMode).toBe(false);

    expect(mocks.dynamoSend).toHaveBeenCalledTimes(1);
    expect(mocks.snsSend).not.toHaveBeenCalled();

    const item = mocks.dynamoSend.mock.calls[0][0].input.Item;

    expect(Number(item.currentCost.N)).toBe(0);
    expect(item.previousCost.NULL).toBe(true);
    expect(item.percentageChange.NULL).toBe(true);
    expect(item.comparisonAvailable.BOOL).toBe(false);
    expect(item.comparisonStatus.S).toBe(
      "HISTORICAL_DATA_UNAVAILABLE"
    );
  });

  test("propagates Cost Explorer permission errors", async () => {
    mocks.costSend
      .mockReset()
      .mockRejectedValue(new Error("Access denied"));

    await expect(handler()).rejects.toThrow("Access denied");

    expect(mocks.dynamoSend).not.toHaveBeenCalled();
    expect(mocks.snsSend).not.toHaveBeenCalled();
  });

  test("detects cost increases and sends an SNS alert", async () => {
    await handler();

    const item = mocks.dynamoSend.mock.calls[0][0].input.Item;

    expect(Number(item.percentageChange.N)).toBe(25);
    expect(Number(item.anomalyThreshold.N)).toBe(20);
    expect(item.anomalyDetected.BOOL).toBe(true);
    expect(item.trend.S).toBe("INCREASING");
    expect(mocks.snsSend).toHaveBeenCalledTimes(1);
  });
});
