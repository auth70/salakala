import { SecretProvider } from '../SecretProvider.js';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { execSync } from 'child_process';

/**
 * Provider for accessing secrets stored in AWS Secrets Manager.
 * Uses AWS SDK v3 for JavaScript/TypeScript.
 * 
 * Authentication is handled via standard AWS credential chain:
 * - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 * - AWS credentials file (~/.aws/credentials)
 * - IAM roles for Amazon EC2
 * - Container credentials (ECS/EKS)
 * 
 * @implements {SecretProvider}
 * @see {@link https://docs.aws.amazon.com/secretsmanager/} for AWS Secrets Manager documentation
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-secrets-manager/} for SDK documentation
 */
export class AWSSecretsManagerProvider extends SecretProvider {
    /**
     * Cache of AWS Secrets Manager clients for different regions to avoid
     * recreating clients for the same region.
     */
    private clients: Map<string, SecretsManager>;

    /**
     * Initializes a new AWSSecretsManagerProvider with an empty client cache.
     */
    constructor() {
        super();
        this.clients = new Map();
    }

    /**
     * Gets or creates an AWS Secrets Manager client for the specified region.
     * 
     * @param {string} region - The AWS region (e.g., us-east-1, eu-west-1)
     * @returns {SecretsManager} A configured AWS Secrets Manager client instance
     * @private
     */
    private getClient(region: string): SecretsManager {
        if (!this.clients.has(region)) {
            this.clients.set(region, new SecretsManager({ region }));
        }
        return this.clients.get(region)!;
    }

    /**
     * Retrieves a secret value from AWS Secrets Manager.
     * 
     * @param {string} path - The AWS Secrets Manager reference path
     *                        Format: awssm://region/secret-name[::jsonKey]
     *                        Example: awssm://us-east-1/production/database-password
     *                        Example with JSON: awssm://us-east-1/config/database::host
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Parse the path to separate the AWS reference from any JSON key
        const parsedPath = this.parsePath(path);
        
        // Extract region and secret name from the path
        const pathMatch = parsedPath.path.match(/^([^\/]+)\/(.+)$/);
        if (!pathMatch) {
            throw new Error('Invalid AWS secret path format. Expected: awssm://region/secret-name[::jsonKey]');
        }

        const [, region, secretId] = pathMatch;
        const client = this.getClient(region);

        try {
            // Retrieve the secret value from AWS Secrets Manager
            const response = await client.getSecretValue({ SecretId: secretId });
            
            if (!response.SecretString && !response.SecretBinary) {
                throw new Error('Secret value is empty');
            }

            const secretValue = response.SecretString || 
                Buffer.from(response.SecretBinary!).toString();

            // If there's a JSON key, parse and extract the value
            if (parsedPath.jsonKey) {
                return this.returnPossibleJsonValue(secretValue, parsedPath.jsonKey);
            }

            // If no key specified, return the raw value
            return secretValue;
        } catch (error: unknown) {
            if (error instanceof Error) {
                // If it's our own error, throw it directly
                if (error.message.includes('Key') || 
                    error.message.includes('JSON') || 
                    error.message.includes('empty')) {
                    throw error;
                }

                // For authentication issues, try to reauthenticate
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('credentials') || 
                    errorMessage.includes('authentication') || 
                    errorMessage.includes('access denied')) {
                    
                    const response = await this.promptForAuthentication();
                    if (response) {
                        this.clients.delete(region);
                        return this.getSecret(path);
                    }
                }

                throw new Error(`Failed to read AWS secret: ${error.message}`);
            }
            throw new Error('Failed to read AWS secret: Unknown error');
        }
    }

    /**
     * Prompts the user to configure AWS credentials and runs the aws configure command if they agree.
     * @returns {Promise<boolean>} True if authentication was attempted
     * @private
     */
    private async promptForAuthentication(): Promise<boolean> {
        try {
            console.log('\nWould you like to configure AWS credentials now? (y/N)');
            const response = await new Promise<string>((resolve) => {
                process.stdin.resume();
                process.stdin.once('data', (data) => {
                    process.stdin.pause();
                    resolve(data.toString().trim().toLowerCase());
                });
            });

            if (response === 'y' || response === 'yes') {
                console.log('\nRunning AWS configuration...');
                execSync('aws configure', { stdio: 'inherit' });
                return true;
            }
        } catch (error) {
            console.error('Failed to run AWS configuration command:', error);
        }
        
        return false;
    }
}