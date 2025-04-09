import { SecretConfig } from "./SecretProvider.js";
import { readFileSync } from "fs";
import { OnePasswordProvider } from "./providers/1Password.js";
import { GoogleCloudSecretsProvider } from "./providers/GoogleCloudSecrets.js";
import { AWSSecretsManagerProvider } from "./providers/AWSSecretsManager.js";
import { BitwardenProvider } from "./providers/Bitwarden.js";
import { AzureKeyVaultProvider } from "./providers/AzureKeyVault.js";
import { LastPassProvider } from "./providers/LastPass.js";
import { KeePassProvider } from "./providers/KeePass.js";
import { SecretProvider } from "./SecretProvider.js";

/**
 * Main secrets management class that coordinates multiple secret providers.
 * Handles routing secret requests to appropriate providers and loading secret configurations.
 */
export class SecretsManager {
    /**
     * Map of URL-like prefixes to their corresponding secret providers.
     * Each prefix (e.g., 'op://', 'awssm://') is mapped to its provider implementation.
     */
    private providers: Map<string, SecretProvider>;
    
    /**
     * Initializes a new SecretsManager with all supported secret providers.
     * Each provider is mapped to its corresponding URL-like prefix for routing.
     */
    constructor() {
        this.providers = new Map<string, SecretProvider>([
            ['op://', new OnePasswordProvider()],
            ['gcsm://', new GoogleCloudSecretsProvider()],
            ['awssm://', new AWSSecretsManagerProvider()],
            ['bw://', new BitwardenProvider()],
            ['azurekv://', new AzureKeyVaultProvider()],
            ['lp://', new LastPassProvider()],
            ['kp://', new KeePassProvider()],
        ]);
    }

    /**
     * Substitutes environment variables in a secret path.
     * Variables are specified in the format ${VARIABLE_NAME} and are replaced with their values from process.env.
     * 
     * @param {string} secretPath - The secret path that may contain environment variable references
     * @returns {string} The secret path with environment variables substituted
     * @throws {Error} If a referenced environment variable is not defined
     * @private
     */
    private substituteVariables(secretPath: string): string {
        return secretPath.replace(/\${([^}]+)}/g, (match, varName) => {
            const value = process.env[varName];
            if (value === undefined) {
                throw new Error(`Environment variable '${varName}' referenced in secret path '${secretPath}' is not defined`);
            }
            return value;
        });
    }

    /**
     * Loads secrets from a configuration file and retrieves their values from appropriate providers.
     * Supports both flat configurations and environment-specific configurations.
     * 
     * @param {string} configPath - Path to the JSON configuration file
     * @param {string} [environment='development'] - Environment name for environment-specific configs
     * @returns {Promise<Record<string, string>>} Object mapping environment variables to their secret values
     * @throws {Error} If the config file is invalid, environment not found, or secret retrieval fails
     */
    async loadSecrets(configPath: string, environment: string = 'development'): Promise<Record<string, string>> {
        const configContent = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        
        // Determine if this is a flat config or environment-based config
        const isFlatConfig = Object.values(config).every(value => typeof value === 'string');
        
        // Get the appropriate config based on structure
        const secretsConfig: SecretConfig = isFlatConfig 
            ? config 
            : (config[environment] || null);

        if (!isFlatConfig && !secretsConfig) {
            throw new Error(`Environment '${environment}' not found in config file. Available environments: ${Object.keys(config).join(', ')}`);
        }

        // Group secrets by provider prefix
        const secretsByProvider = new Map<string, Map<string, string>>();
        const secrets: Record<string, string> = {};

        for (const [envVar, secretPath] of Object.entries(secretsConfig)) {
            // Substitute environment variables in the secret path
            const resolvedPath = this.substituteVariables(secretPath);
            const prefix = Array.from(this.providers.keys()).find(p => resolvedPath.startsWith(p));
            if (!prefix) {
                // If no provider prefix is found, treat it as a regular value
                secrets[envVar] = resolvedPath;
                continue;
            }
            
            if (!secretsByProvider.has(prefix)) {
                secretsByProvider.set(prefix, new Map());
            }
            secretsByProvider.get(prefix)!.set(envVar, resolvedPath);
        }

        // Process all providers sequentially
        for (const [prefix, secretGroup] of secretsByProvider) {
            const provider = this.providers.get(prefix)!;
            for (const [envVar, secretPath] of secretGroup.entries()) {
                try {
                    console.info(`🔒 Fetching ${envVar} from ${secretPath}`);
                    const secretValue = await provider.getSecret(secretPath);
                    secrets[envVar] = secretValue;
                } catch (error: unknown) {
                    const err = error instanceof Error ? error.message : String(error);
                    // If an error occurs, throw it immediately
                    throw new Error(`Failed to get value for ${envVar} using ${secretPath}:\n- ${err}`);
                }
            }
        }

        return secrets;
    }
}
