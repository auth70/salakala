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
export class AWSSecretsManagerProvider implements SecretProvider {
    /**
     * Cache of AWS Secrets Manager clients for different regions to avoid
     * recreating clients for the same region.
     */
    private clients: Map<string, SecretsManager>;

    /**
     * Initializes a new AWSSecretsManagerProvider with an empty client cache.
     */
    constructor() {
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
     *                        Format: awssm://region/secret-name
     *                        Example: awssm://us-east-1/production/database-password
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {
        // Format: awssm://region/secret-name
        const match = path.match(/^awssm:\/\/([^\/]+)\/(.+)$/);
        if (!match) {
            throw new Error('Invalid AWS secret path format. Expected: awssm://region/secret-name');
        }

        const [, region, secretId] = match;
        const client = this.getClient(region);

        try {
            // Retrieve the secret value from AWS Secrets Manager
            const response = await client.getSecretValue({ SecretId: secretId });
            
            if (response.SecretString) {
                try {
                    // Attempt to parse as JSON
                    JSON.parse(response.SecretString);
                    // If successful, return the raw string for JSON handling
                    return response.SecretString;
                } catch {
                    // If not JSON, return as is
                    return response.SecretString;
                }
            }
            
            if (response.SecretBinary) {
                // Convert binary data to string and try parsing as JSON first
                const stringData = Buffer.from(response.SecretBinary).toString();
                try {
                    // Attempt to parse as JSON
                    JSON.parse(stringData);
                    // If successful, return the string for JSON handling
                    return stringData;
                } catch {
                    // If not JSON, fall back to base64 encoding
                    return Buffer.from(response.SecretBinary).toString('base64');
                }
            }
            
            throw new Error('Secret value is empty');
        } catch (error: unknown) {
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                // Check for common authentication/credentials errors
                if (errorMessage.includes('credentials') || 
                    errorMessage.includes('authentication') || 
                    errorMessage.includes('access denied') ||
                    errorMessage.includes('not authorized')) {
                    
                    // Ask if they want to configure AWS credentials
                    const response = await this.promptForAuthentication();
                    if (response) {
                        throw new Error('Please try accessing the secret again after AWS configuration is complete.');
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