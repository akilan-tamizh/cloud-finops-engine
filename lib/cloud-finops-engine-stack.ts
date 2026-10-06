import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';


export class CloudFinopsEngineStack extends cdk.Stack {

  constructor(
    scope: Construct,
    id: string,
    props?: cdk.StackProps
  ) {

    super(scope, id, props);


    // ============================================================
    // 1. DYNAMODB
    // ============================================================

    const finOpsTable =
      new dynamodb.Table(
        this,
        'FinOpsTable',
        {

          tableName:
            'FinOpsIssues',

          partitionKey: {
            name: 'issueId',
            type:
              dynamodb.AttributeType.STRING,
          },

          billingMode:
            dynamodb.BillingMode.PAY_PER_REQUEST,

          removalPolicy:
            cdk.RemovalPolicy.DESTROY,

        }
      );


    // ============================================================
    // 2. SNS ALERTS
    // ============================================================

    const alertsTopic =
      new sns.Topic(
        this,
        'FinOpsAlertsTopic'
      );


    // ============================================================
    // 3. RESOURCE SCANNER
    // ============================================================

    const resourceScanner =
      new lambdaNodejs.NodejsFunction(
        this,
        'ResourceScannerLambda',
        {

          runtime:
            lambda.Runtime.NODEJS_22_X,

          entry:
            'backend/resource-scanner/index.ts',

          handler:
            'handler',

          timeout:
            cdk.Duration.seconds(60),

          memorySize:
            256,

          environment: {

            FINOPS_TABLE_NAME:
              finOpsTable.tableName,

            SNS_TOPIC_ARN:
              alertsTopic.topicArn,

          },

        }
      );


    resourceScanner.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [

          'ec2:DescribeInstances',

          'ec2:DescribeVolumes',

          'ec2:DescribeAddresses',

        ],

        resources: ['*'],

      })
    );


    resourceScanner.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'dynamodb:PutItem',
        ],

        resources: [
          finOpsTable.tableArn,
        ],

      })
    );


    resourceScanner.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'sns:Publish',
        ],

        resources: [
          alertsTopic.topicArn,
        ],

      })
    );


    // ============================================================
    // 4. RESOURCE SCANNER SCHEDULE
    // ============================================================

    const scannerRule =
      new events.Rule(
        this,
        'ResourceScannerSchedule',
        {

          schedule:
            events.Schedule.rate(
              cdk.Duration.hours(1)
            ),

        }
      );


    scannerRule.addTarget(
      new targets.LambdaFunction(
        resourceScanner
      )
    );


    // ============================================================
    // 5. COST ANALYZER
    // ============================================================

    const costAnalyzer =
      new lambdaNodejs.NodejsFunction(
        this,
        'CostAnalyzerLambda',
        {

          runtime:
            lambda.Runtime.NODEJS_22_X,

          entry:
            'backend/cost-analyzer/index.ts',

          handler:
            'handler',

          timeout:
            cdk.Duration.seconds(60),

          memorySize:
            256,

          environment: {

            FINOPS_TABLE_NAME:
              finOpsTable.tableName,

            SNS_TOPIC_ARN:
              alertsTopic.topicArn,

          },

        }
      );


    costAnalyzer.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'ce:GetCostAndUsage',
        ],

        resources: ['*'],

      })
    );


    costAnalyzer.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'dynamodb:PutItem',
        ],

        resources: [
          finOpsTable.tableArn,
        ],

      })
    );


    costAnalyzer.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'sns:Publish',
        ],

        resources: [
          alertsTopic.topicArn,
        ],

      })
    );


    // ============================================================
    // 6. COST ANALYZER SCHEDULE
    // ============================================================

    const costAnalyzerRule =
      new events.Rule(
        this,
        'CostAnalyzerSchedule',
        {

          schedule:
            events.Schedule.rate(
              cdk.Duration.days(1)
            ),

        }
      );


    costAnalyzerRule.addTarget(
      new targets.LambdaFunction(
        costAnalyzer
      )
    );


    // ============================================================
    // 7. DASHBOARD API LAMBDA
    // ============================================================

    const dashboardApi =
      new lambdaNodejs.NodejsFunction(
        this,
        'DashboardApiLambda',
        {

          runtime:
            lambda.Runtime.NODEJS_22_X,

          entry:
            'backend/dashboard-api/index.ts',

          handler:
            'handler',

          timeout:
            cdk.Duration.seconds(30),

          memorySize:
            256,

          environment: {

            FINOPS_TABLE_NAME:
              finOpsTable.tableName,

          },

        }
      );


    dashboardApi.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'dynamodb:Scan',
        ],

        resources: [
          finOpsTable.tableArn,
        ],

      })
    );


    // ============================================================
    // 8. SAFE EC2 OPTIMIZER LAMBDA
    // ============================================================

    const optimizer =
      new lambdaNodejs.NodejsFunction(
        this,
        'OptimizerLambda',
        {

          runtime:
            lambda.Runtime.NODEJS_22_X,

          entry:
            'backend/optimizer/index.ts',

          handler:
            'handler',

          timeout:
            cdk.Duration.seconds(60),

          memorySize:
            256,

          environment: {

            FINOPS_TABLE_NAME:
              finOpsTable.tableName,

            SNS_TOPIC_ARN:
              alertsTopic.topicArn,

          },

        }
      );


    // ============================================================
    // 9. OPTIMIZER IAM PERMISSIONS
    // ============================================================

    optimizer.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [

          'ec2:DescribeInstances',

          'ec2:StopInstances',

        ],

        resources: ['*'],

      })
    );


    optimizer.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'dynamodb:PutItem',
        ],

        resources: [
          finOpsTable.tableArn,
        ],

      })
    );


    optimizer.addToRolePolicy(
      new iam.PolicyStatement({

        actions: [
          'sns:Publish',
        ],

        resources: [
          alertsTopic.topicArn,
        ],

      })
    );


    // ============================================================
    // 10. OPTIMIZER SCHEDULE
    // ============================================================

    const optimizerRule =
      new events.Rule(
        this,
        'OptimizerSchedule',
        {

          schedule:
            events.Schedule.rate(
              cdk.Duration.hours(1)
            ),

        }
      );


    optimizerRule.addTarget(
      new targets.LambdaFunction(
        optimizer
      )
    );


    // ============================================================
    // 11. S3 DASHBOARD BUCKET
    // ============================================================

    const dashboardBucket =
      new s3.Bucket(
        this,
        'DashboardBucket',
        {

          blockPublicAccess:
            s3.BlockPublicAccess.BLOCK_ALL,

          encryption:
            s3.BucketEncryption.S3_MANAGED,

          objectOwnership:
            s3.ObjectOwnership
              .BUCKET_OWNER_ENFORCED,

          removalPolicy:
            cdk.RemovalPolicy.DESTROY,

          autoDeleteObjects:
            true,

        }
      );


    // ============================================================
    // 12. CLOUDFRONT
    // ============================================================

    const dashboardOrigin =
      origins.S3BucketOrigin
        .withOriginAccessControl(
          dashboardBucket
        );


    const dashboardDistribution =
      new cloudfront.Distribution(
        this,
        'DashboardDistribution',
        {

          defaultRootObject:
            'index.html',

          defaultBehavior: {

            origin:
              dashboardOrigin,

            viewerProtocolPolicy:
              cloudfront
                .ViewerProtocolPolicy
                .REDIRECT_TO_HTTPS,

            allowedMethods:
              cloudfront
                .AllowedMethods
                .ALLOW_GET_HEAD_OPTIONS,

            cachePolicy:
              cloudfront
                .CachePolicy
                .CACHING_DISABLED,

          },

          errorResponses: [

            {

              httpStatus:
                403,

              responseHttpStatus:
                200,

              responsePagePath:
                '/index.html',

            },

            {

              httpStatus:
                404,

              responseHttpStatus:
                200,

              responsePagePath:
                '/index.html',

            },

          ],

        }
      );


    // ============================================================
    // 13. COGNITO USER POOL
    // ============================================================

    const userPool =
      new cognito.UserPool(
        this,
        'FinOpsUserPool',
        {

          userPoolName:
            'CloudFinOpsUserPool',

          selfSignUpEnabled:
            true,

          signInAliases: {
            email: true,
          },

          autoVerify: {
            email: true,
          },

          passwordPolicy: {

            minLength:
              8,

            requireLowercase:
              true,

            requireUppercase:
              true,

            requireDigits:
              true,

            requireSymbols:
              true,

          },

          accountRecovery:
            cognito.AccountRecovery
              .EMAIL_ONLY,

          removalPolicy:
            cdk.RemovalPolicy.DESTROY,

        }
      );


    // ============================================================
    // 14. COGNITO DOMAIN
    // ============================================================

    const userPoolDomain =
      userPool.addDomain(
        'FinOpsUserPoolDomain',
        {

          cognitoDomain: {

            domainPrefix:
              `cloud-finops-${this.account}`,

          },

        }
      );


    // ============================================================
    // 15. API GATEWAY
    // ============================================================

    const dashboardApiGateway =
      new apigateway.RestApi(
        this,
        'DashboardApiGateway',
        {

          restApiName:
            'Cloud FinOps Dashboard API',

          defaultCorsPreflightOptions: {

            allowOrigins:
              apigateway.Cors.ALL_ORIGINS,

            allowMethods:
              apigateway.Cors.ALL_METHODS,

            allowHeaders:
              apigateway.Cors.DEFAULT_HEADERS,

          },

        }
      );


    // ============================================================
    // 16. COGNITO API AUTHORIZER
    // ============================================================

    const cognitoAuthorizer =
      new apigateway
        .CognitoUserPoolsAuthorizer(
          this,
          'FinOpsApiAuthorizer',
          {

            cognitoUserPools: [
              userPool,
            ],

          }
        );


    // ============================================================
    // 17. DASHBOARD API ROUTE
    // ============================================================

    const dashboardResource =
      dashboardApiGateway.root
        .addResource(
          'dashboard'
        );


    dashboardResource.addMethod(
      'GET',

      new apigateway.LambdaIntegration(
        dashboardApi
      ),

      {

        authorizer:
          cognitoAuthorizer,

        authorizationType:
          apigateway
            .AuthorizationType
            .COGNITO,

      }
    );


    // ============================================================
    // 18. COGNITO APP CLIENT
    // ============================================================

    const userPoolClient =
      userPool.addClient(
        'FinOpsUserPoolClient',
        {

          generateSecret:
            false,

          authFlows: {

            userSrp:
              true,

          },

          oAuth: {

            flows: {

              authorizationCodeGrant:
                true,

            },

            scopes: [

              cognito.OAuthScope.OPENID,

              cognito.OAuthScope.EMAIL,

              cognito.OAuthScope.PROFILE,

            ],

            callbackUrls: [

              `https://${dashboardDistribution.domainName}`,

            ],

            logoutUrls: [

              `https://${dashboardDistribution.domainName}`,

            ],

          },

        }
      );


    // ============================================================
    // 19. FRONTEND DEPLOYMENT
    // ============================================================

    new s3deploy.BucketDeployment(
      this,
      'DashboardDeployment',
      {

        sources: [

          s3deploy.Source.asset(
            './frontend'
          ),

        ],

        destinationBucket:
          dashboardBucket,

        distribution:
          dashboardDistribution,

        distributionPaths: [
          '/*',
        ],

      }
    );


    // ============================================================
    // 20. OUTPUTS
    // ============================================================

    new cdk.CfnOutput(
      this,
      'FinOpsTableName',
      {

        value:
          finOpsTable.tableName,

      }
    );


    new cdk.CfnOutput(
      this,
      'ResourceScannerLambdaName',
      {

        value:
          resourceScanner.functionName,

      }
    );


    new cdk.CfnOutput(
      this,
      'CostAnalyzerLambdaName',
      {

        value:
          costAnalyzer.functionName,

      }
    );


    new cdk.CfnOutput(
      this,
      'DashboardApiLambdaName',
      {

        value:
          dashboardApi.functionName,

      }
    );


    new cdk.CfnOutput(
      this,
      'OptimizerLambdaName',
      {

        value:
          optimizer.functionName,

      }
    );


    new cdk.CfnOutput(
      this,
      'FinOpsAlertsTopicArn',
      {

        value:
          alertsTopic.topicArn,

      }
    );


    new cdk.CfnOutput(
      this,
      'DashboardBucketName',
      {

        value:
          dashboardBucket.bucketName,

      }
    );


    new cdk.CfnOutput(
      this,
      'DashboardWebsiteUrl',
      {

        value:
          `https://${dashboardDistribution.domainName}`,

      }
    );


    new cdk.CfnOutput(
      this,
      'DashboardApiEndpoint',
      {

        value:
          dashboardApiGateway.url,

      }
    );


    new cdk.CfnOutput(
      this,
      'DashboardApiUrl',
      {

        value:
          `${dashboardApiGateway.url}dashboard`,

      }
    );


    new cdk.CfnOutput(
      this,
      'ScannerSchedule',
      {

        value:
          'Every 1 hour',

      }
    );


    new cdk.CfnOutput(
      this,
      'CostAnalyzerScheduleOutput',
      {

        value:
          'Every 1 day',

      }
    );


    new cdk.CfnOutput(
      this,
      'OptimizerScheduleOutput',
      {

        value:
          'Every 1 hour',

      }
    );


    new cdk.CfnOutput(
      this,
      'CognitoUserPoolId',
      {

        value:
          userPool.userPoolId,

      }
    );


    new cdk.CfnOutput(
      this,
      'CognitoClientId',
      {

        value:
          userPoolClient.userPoolClientId,

      }
    );


    new cdk.CfnOutput(
      this,
      'CognitoDomain',
      {

        value:
          userPoolDomain.domainName,

      }
    );


    new cdk.CfnOutput(
      this,
      'CognitoLoginUrl',
      {

        value:
          `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/login?client_id=${userPoolClient.userPoolClientId}&response_type=code&scope=email+openid+profile&redirect_uri=https://${dashboardDistribution.domainName}`,

      }
    );

  }
}