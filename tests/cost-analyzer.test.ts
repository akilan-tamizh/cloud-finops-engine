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

import { handler } from "../backend/cost-analyzer/index";

describe("Cloud FinOps Cost Analyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mocks.costSend.mockResolvedValue({
      ResultsByTime: [],
    });

    mocks.dynamoSend.mockResolvedValue({});
    mocks.snsSend.mockResolvedValue({});
  });

  afterAll(() => {
    delete (globalThis as any).__finopsMocks;
  });

  test("uses labelled demo costs when real costs are zero", async () => {
    const response = await handler();
    const result = JSON.parse(response.body);

    expect(result.currentCost).toBe(18.4);
    expect(result.previousCost).toBe(15.2);
    expect(result.percentageChange).toBe(21.05);
    expect(result.trend).toBe("INCREASING");
    expect(result.anomalyDetected).toBe(true);
    expect(result.demoMode).toBe(true);
    expect(result.dataSource).toBe("DEMO_COST_DATA");
  });

  test("stores the analysis in DynamoDB", async () => {
    await handler();

    expect(mocks.dynamoSend).toHaveBeenCalledTimes(1);

    const command = mocks.dynamoSend.mock.calls[0][0];

    expect(command.input.Item.type.S).toBe("COST_ANALYSIS");
    expect(command.input.Item.demoMode.BOOL).toBe(true);
    expect(command.input.Item.dataSource.S).toBe(
      "DEMO_COST_DATA"
    );
  });

  test("uses demo costs when Cost Explorer data is unavailable", async () => {
    const unavailable = Object.assign(
      new Error("Cost data unavailable"),
      { name: "DataUnavailableException" }
    );

    mocks.costSend.mockRejectedValue(unavailable);

    const response = await handler();
    const result = JSON.parse(response.body);

    expect(result.demoMode).toBe(true);
    expect(result.currentCost).toBe(18.4);
    expect(result.previousCost).toBe(15.2);
  });

  test("propagates unexpected Cost Explorer errors", async () => {
    mocks.costSend.mockRejectedValue(
      new Error("Access denied")
    );

    await expect(handler()).rejects.toThrow("Access denied");

    expect(mocks.dynamoSend).not.toHaveBeenCalled();
  });

  test("detects a cost increase above the anomaly threshold", async () => {
    await handler();

    const command = mocks.dynamoSend.mock.calls[0][0];
    const item = command.input.Item;

    expect(Number(item.percentageChange.N)).toBe(21.05);
    expect(Number(item.anomalyThreshold.N)).toBe(20);
    expect(item.anomalyDetected.BOOL).toBe(true);
  });
});
