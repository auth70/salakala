import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { SecretProvider, PathComponentType } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';
import { EMOJI } from '../constants.js';

/**
 * Provider for accessing secrets stored in Google Cloud Secret Manager.
 * Uses the official Google Cloud client libraries for Node.js.
 * 
 * Authentication is handled via Google Cloud's standard authentication methods:
 * - Service account key file (GOOGLE_APPLICATION_CREDENTIALS)
 * - Application Default Credentials
 * - Google Cloud CLI credentials
 * - Compute Engine default service account
 * - Cloud Run/Functions runtime service account
 * 
 * @implements {SecretProvider}
 * @see {@link https://cloud.google.com/secret-manager/docs} for Google Cloud Secret Manager documentation
 * @see {@link https://github.com/googleapis/nodejs-secret-manager} for client library documentation
 */
export class GoogleCloudSecretsProvider extends SecretProvider {
    readonly supportsMultipleFields = false;
    readonly pathComponents = [
        { name: 'project', type: PathComponentType.Project, description: 'GCP project ID', required: true },
        { name: 'secret', type: PathComponentType.Item, description: 'Secret name', required: true },
        { name: 'version', type: PathComponentType.Version, description: 'Version', required: false, default: 'latest' },
    ];

    /**
     * Client instance for interacting with Google Cloud Secret Manager.
     * A single client is used as it handles multiple projects and regions internally.
     */
    private client: SecretManagerServiceClient;
    private cli: CliHandler;
    
    /**
     * Initializes a new GoogleCloudSecretsProvider with a Secret Manager client.
     * The client will use Application Default Credentials for authentication.
     */
    constructor() {
        super();
        this.client = new SecretManagerServiceClient();
        this.cli = new CliHandler();
    }

    buildPath(components: Record<string, string>, opts?: { fieldName?: string }): string {
        const { project, secret, version = 'latest' } = components;
        return `gcsm://projects/${project}/secrets/${secret}/versions/${version}`;
    }
    
    /**
     * Retrieves a secret value from Google Cloud Secret Manager.
     * 
     * @param {string} path - The Google Cloud secret reference path
     *                        Format: gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION[::jsonKey]
     *                        Example: gcsm://projects/my-project/secrets/api-key/versions/latest
     *                        Example with JSON: gcsm://projects/my-project/secrets/config/versions/latest::database.host
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved.
     *                 Provides detailed authentication instructions if authentication fails.
     */
    async getSecret(path: string): Promise<string> {
        // Parse the path to separate the GCS reference from any JSON key
        const parsedPath = this.parsePath(path);
        
        // Extract project, secret, and version from the parsed path
        const [, projectId, secretId, version] = this.parsePathWithRegex(
            parsedPath.path,
            /^projects\/([^\/]+)\/secrets\/([^\/]+)\/versions\/(.+)$/,
            'gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION[::jsonKey]'
        );
        const secretPath = `projects/${projectId}/secrets/${secretId}/versions/${version}`;

        try {
            // Access the specified version of the secret
            const [response] = await this.client.accessSecretVersion({
                name: secretPath,
            });
            
            if (!response.payload?.data) {
                throw new Error('Secret payload is empty');
            }

            // Convert to string if it's a Buffer
            const secretValue = typeof response.payload.data === 'string' 
                ? response.payload.data 
                : Buffer.from(response.payload.data).toString();

            // If there's a JSON key, parse and extract the value
            if (parsedPath.jsonKey) {
                return this.returnPossibleJsonValue(secretValue, parsedPath.jsonKey);
            }

            // No key specified, return as is
            return secretValue.trim();

        } catch (error: unknown) {
            if (error instanceof Error) {
                // If it's our own error, throw it directly
                if (error.message.includes('Key') || 
                    error.message.includes('JSON') || 
                    error.message.includes('empty')) {
                    throw error;
                }

                const errorMessage = error.message.toLowerCase();
                // Provide helpful authentication instructions for auth-related errors
                if (errorMessage.includes('permission denied') || 
                    errorMessage.includes('unauthenticated') || 
                    errorMessage.includes('unauthorized') ||
                    errorMessage.includes('could not load the default credentials')) {
                    
                    // Ask if they want to run the auth command
                    const response = await this.cli.promptForAuthentication(
                        'Google Cloud',
                        'gcloud auth application-default login'
                    );
                    if (response) {
                        throw new Error('Please try accessing the secret again after the authentication is complete.');
                    }
                    
                    const loginInstructions = `
Authentication failed. Please authenticate with Google Cloud:

1. Install the Google Cloud CLI (gcloud) if not installed:
   https://cloud.google.com/sdk/docs/install

2. Run the following command to log in:
   gcloud auth application-default login

3. Try accessing the secret again after authentication is complete.`;
                    throw new Error(`Failed to read Google Cloud secret: ${error.message}\n${loginInstructions}`);
                }
            }
            
            this.wrapProviderError(error, 'read', 'Google Cloud Secret Manager');
        }
    }

    /**
     * Stores a secret value in Google Cloud Secret Manager.
     * Creates a new secret if it doesn't exist, or adds a new version if it does.
     * 
     * @param {string} path - The Google Cloud secret reference path
     *                        Format: gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION
     *                        Example: gcsm://projects/my-project/secrets/api-key/versions/latest
     *                        Note: VERSION is ignored for writes; a new version is always created
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be written
     */
    async setSecret(path: string, value: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        const [, projectId, secretId] = this.parsePathWithRegex(
            parsedPath.path,
            /^projects\/([^\/]+)\/secrets\/([^\/]+)\/versions\/(.+)$/,
            'gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION'
        );
        const parent = `projects/${projectId}`;
        const secretName = `projects/${projectId}/secrets/${secretId}`;

        try {
            // Try to create the secret - if it already exists, we'll catch that error
            try {
                console.log(`${EMOJI.CREATING} Creating secret ${secretId}...`);
                await this.client.createSecret({
                    parent: parent,
                    secretId: secretId,
                    secret: {
                        replication: {
                            automatic: {},
                        },
                    },
                });
            } catch (error: any) {
                // Error code 6 = ALREADY_EXISTS - that's fine, we'll just add a version
                if (error.code === 6) {
                    console.log(`${EMOJI.EXISTING} Secret ${secretId} already exists, adding new version...`);
                } else {
                    // Any other error should be thrown
                    throw error;
                }
            }

            // Add a new version to the secret (whether we just created it or it already existed)
            await this.client.addSecretVersion({
                parent: secretName,
                payload: {
                    data: Buffer.from(value, 'utf8'),
                },
            });

        } catch (error: unknown) {
            this.wrapProviderError(error, 'write', 'Google Cloud Secret Manager');
        }
    }

    /**
     * Deletes a secret from Google Cloud Secret Manager.
     * 
     * @param {string} path - The Google Cloud secret reference path
     *                        Format: gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION
     *                        Example: gcsm://projects/my-project/secrets/api-key/versions/latest
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be deleted
     */
    async deleteSecret(path: string): Promise<void> {
        const parsedPath = this.parsePath(path);
        
        const [, projectId, secretId] = this.parsePathWithRegex(
            parsedPath.path,
            /^projects\/([^\/]+)\/secrets\/([^\/]+)\/versions\/(.+)$/,
            'gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION'
        );
        const secretName = `projects/${projectId}/secrets/${secretId}`;

        try {
            console.log(`${EMOJI.DELETING} Deleting secret ${secretId}...`);
            await this.client.deleteSecret({ name: secretName });
        } catch (error: unknown) {
            this.wrapProviderError(error, 'delete', 'Google Cloud Secret Manager');
        }
    }
}
