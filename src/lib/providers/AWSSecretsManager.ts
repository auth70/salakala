import { SecretProvider, PathComponentType } from '../SecretProvider.js';
import { SecretsManager, CreateSecretCommand, PutSecretValueCommand, DeleteSecretCommand, ResourceExistsException } from '@aws-sdk/client-secrets-manager';
import { CliHandler } from '../CliHandler.js';
import { EMOJI } from '../constants.js';

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
    readonly supportsMultipleFields = false;
    readonly pathComponents = [
        { name: 'region', type: PathComponentType.Region, description: 'AWS region (e.g., us-east-1)', required: true },
        { name: 'secret', type: PathComponentType.Item, description: 'Secret name', required: true },
    ];

    /**
     * Cache of AWS Secrets Manager clients for different regions to avoid
     * recreating clients for the same region.
     */
    private clients: Map<string, SecretsManager>;
    private cli: CliHandler;

    /**
     * Initializes a new AWSSecretsManagerProvider with an empty client cache.
     */
    constructor() {
        super();
        this.clients = new Map();
        this.cli = new CliHandler();
    }

    buildPath(components: Record<string, string>, opts?: { fieldName?: string }): string {
        const { region, secret } = components;
        return `awssm://${region}/${secret}`;
    }

    /**
     * Gets or creates an AWS Secrets Manager client for the specified region.
     * 
     * @param {string} region - The AWS region (e.g., us-east-1, eu-west-1)
     * @returns {SecretsManager} A configured AWS Secrets Manager client instance
     * @private
     */
    private getClient(region: string): SecretsManager {
        return this.getOrCreateClient(this.clients, region, () => new SecretsManager({ region }));
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
        const [, region, secretId] = this.parsePathWithRegex(
            parsedPath.path,
            /^([^\/]+)\/(.+)$/,
            'awssm://region/secret-name[::jsonKey]'
        );
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
                    
                    const response = await this.cli.promptForAuthentication('AWS', 'aws configure');
                    if (response) {
                        this.clients.delete(region);
                        return this.getSecret(path);
                    }
                }
            }
            
            this.wrapProviderError(error, 'read', 'AWS Secrets Manager');
        }
    }

    /**
     * Stores a secret value in AWS Secrets Manager.
     * Creates a new secret if it doesn't exist, or updates if it does.
     * 
     * @param {string} path - The AWS Secrets Manager reference path
     *                        Format: awssm://region/secret-name
     *                        Example: awssm://us-east-1/prod/api-key
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be written
     */
    async setSecret(path: string, value: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        const [, region, secretId] = this.parsePathWithRegex(
            parsedPath.path,
            /^([^\/]+)\/(.+)$/,
            'awssm://region/secret-name'
        );
        const client = this.getClient(region);

        try {
            // Try to create the secret first
            try {
                console.log(`${EMOJI.CREATING} Creating secret ${secretId}...`);
                await client.send(new CreateSecretCommand({
                    Name: secretId,
                    SecretString: value
                }));
            } catch (error: any) {
                // If secret already exists, update it instead
                if (error.name === 'ResourceExistsException' || error instanceof ResourceExistsException) {
                    console.log(`${EMOJI.EXISTING} Secret ${secretId} already exists, updating...`);
                    await client.send(new PutSecretValueCommand({
                        SecretId: secretId,
                        SecretString: value
                    }));
                } else {
                    throw error;
                }
            }
        } catch (error: unknown) {
            this.wrapProviderError(error, 'write', 'AWS Secrets Manager');
        }
    }

    /**
     * Deletes a secret from AWS Secrets Manager.
     * 
     * @param {string} path - The AWS Secrets Manager reference path
     *                        Format: awssm://region/secret-name
     *                        Example: awssm://us-east-1/prod/api-key
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be deleted
     */
    async deleteSecret(path: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        const [, region, secretId] = this.parsePathWithRegex(
            parsedPath.path,
            /^([^\/]+)\/(.+)$/,
            'awssm://region/secret-name'
        );
        const client = this.getClient(region);

        try {
            console.log(`${EMOJI.DELETING} Deleting secret ${secretId}...`);
            await client.send(new DeleteSecretCommand({
                SecretId: secretId,
                ForceDeleteWithoutRecovery: true
            }));
        } catch (error: unknown) {
            this.wrapProviderError(error, 'delete', 'AWS Secrets Manager');
        }
    }
}