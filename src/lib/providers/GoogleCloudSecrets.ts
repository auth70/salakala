import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { SecretProvider } from '../SecretProvider.js';

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
export class GoogleCloudSecretsProvider implements SecretProvider {
    /**
     * Client instance for interacting with Google Cloud Secret Manager.
     * A single client is used as it handles multiple projects and regions internally.
     */
    private client: SecretManagerServiceClient;
    
    /**
     * Initializes a new GoogleCloudSecretsProvider with a Secret Manager client.
     * The client will use Application Default Credentials for authentication.
     */
    constructor() {
        this.client = new SecretManagerServiceClient();
    }
    
    /**
     * Retrieves a secret value from Google Cloud Secret Manager.
     * 
     * @param {string} path - The Google Cloud secret reference path
     *                        Format: gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION_NUMBER
     *                        Example: gcsm://projects/my-project/secrets/api-key/versions/latest
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved.
     *                 Provides detailed authentication instructions if authentication fails.
     */
    async getSecret(path: string): Promise<string> {
        // Format: gcsm://projects/PROJECT_ID/secrets/SECRET_ID/versions/VERSION_NUMBER
        if (!path.startsWith('gcsm://')) {
            throw new Error('Invalid Google Cloud secret path');
        }
        
        // Convert the URL-style path to GCP resource path format
        const gcpPath = path.replace('gcsm://', '');
        try {
            // Access the specified version of the secret
            const [version] = await this.client.accessSecretVersion({
                name: gcpPath,
            });
            
            if (!version.payload?.data) {
                throw new Error('Secret payload is empty');
            }

            // If the data is already a string, return it directly
            if (typeof version.payload.data === 'string') {
                return version.payload.data.trim();
            }
            
            // For Buffer data, try to convert to string first
            try {
                const stringData = Buffer.from(version.payload.data).toString('utf8');
                // Check if it's a valid UTF-8 string by re-encoding
                if (Buffer.from(stringData, 'utf8').toString('utf8') === stringData) {
                    return stringData.trim();
                }
            } catch {
                // If string conversion fails, fall through to base64
            }
            
            // Fall back to base64 for binary data
            return Buffer.from(version.payload.data).toString('base64');
        } catch (error: unknown) {
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                // Provide helpful authentication instructions for auth-related errors
                if (errorMessage.includes('permission denied') || 
                    errorMessage.includes('unauthenticated') || 
                    errorMessage.includes('unauthorized') ||
                    errorMessage.includes('could not load the default credentials')) {
                    
                    // Ask if they want to run the auth command
                    const response = await this.promptForAuthentication();
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
                throw new Error(`Failed to read Google Cloud secret: ${error.message}`);
            }
            throw new Error('Failed to read Google Cloud secret: Unknown error');
        }
    }

    /**
     * Prompts the user to authenticate and runs the gcloud command if they agree.
     * @returns {Promise<boolean>} True if authentication was attempted
     */
    private async promptForAuthentication(): Promise<boolean> {
        const { execSync } = await import('child_process');
        
        try {
            console.log('\nWould you like to authenticate with Google Cloud now? (y/N)');
            const response = await new Promise<string>((resolve) => {
                process.stdin.resume();
                process.stdin.once('data', (data) => {
                    process.stdin.pause();
                    resolve(data.toString().trim().toLowerCase());
                });
            });

            if (response === 'y' || response === 'yes') {
                console.log('\nRunning authentication command...');
                execSync('gcloud auth application-default login', { stdio: 'inherit' });
                return true;
            }
        } catch (error) {
            console.error('Failed to run authentication command:', error);
        }
        
        return false;
    }
}
