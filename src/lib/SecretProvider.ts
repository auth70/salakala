import { readFileSync } from "fs";
import { OnePasswordProvider } from "./providers/1Password.js";
import { GoogleCloudSecretsProvider } from "./providers/GoogleCloudSecrets.js";
import { AWSSecretsManagerProvider } from "./providers/AWSSecretsManager.js";
import { BitwardenProvider } from "./providers/Bitwarden.js";
import { AzureKeyVaultProvider } from "./providers/AzureKeyVault.js";
import { HashiCorpVaultProvider } from "./providers/HashiCorpVault.js";
import { LastPassProvider } from "./providers/LastPass.js";
import { DopplerProvider } from "./providers/Doppler.js";
import { InfisicalProvider } from "./providers/Infisical.js";
import { KeePassProvider } from "./providers/KeePass.js";

/**
 * Interface for secret management providers.
 * Each provider must implement this interface to provide consistent secret retrieval functionality.
 * Providers are responsible for handling their own authentication and secret access mechanisms.
 */
export interface SecretProvider {
    /**
     * Retrieves a secret value from the provider's storage.
     * For binary secrets, the value will be base64 encoded.
     * 
     * @param {string} path - The provider-specific path or identifier for the secret
     * @returns {Promise<string>} The secret value, base64 encoded if binary
     * @throws {Error} If the secret cannot be retrieved or the path is invalid
     */
    getSecret(path: string): Promise<string>;
}

/**
 * Configuration mapping for secrets.
 * Maps environment variable names to secret paths/identifiers.
 */
export interface SecretConfig {
    [key: string]: string;
}

/**
 * Configuration structure for multiple environments.
 * Maps environment names (e.g., 'development', 'production') to their respective secret configurations.
 */
export interface EnvironmentConfigs {
    [environment: string]: SecretConfig;
}

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
            ['hcv://', new HashiCorpVaultProvider()],
            ['lp://', new LastPassProvider()],
            ['doppler://', new DopplerProvider()],
            ['inf://', new InfisicalProvider()],
            ['kp://', new KeePassProvider()],
        ]);
    }
    
    /**
     * Determines the appropriate provider for a given secret path based on its prefix.
     * 
     * @param {string} secretPath - The secret path containing a provider-specific prefix
     * @returns {SecretProvider} The matching provider for the secret path
     * @throws {Error} If no provider matches the secret path's prefix
     * @private
     */
    private getProvider(secretPath: string): SecretProvider {
        for (const [prefix, provider] of this.providers) {
            if (secretPath.startsWith(prefix)) {
                return provider;
            }
        }
        throw new Error(`No provider found for secret path: ${secretPath}`);
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
        for (const [envVar, secretPath] of Object.entries(secretsConfig)) {
            const prefix = Array.from(this.providers.keys()).find(p => secretPath.startsWith(p));
            if (!prefix) {
                throw new Error(`No provider found for secret path: ${secretPath}`);
            }
            
            if (!secretsByProvider.has(prefix)) {
                secretsByProvider.set(prefix, new Map());
            }
            secretsByProvider.get(prefix)!.set(envVar, secretPath);
        }

        const secrets: Record<string, string> = {};
        const errors: Error[] = [];

        // Process each provider's secrets in parallel
        await Promise.all(Array.from(secretsByProvider.entries()).map(async ([prefix, secretGroup]) => {
            const provider = this.providers.get(prefix)!;
            
            // Process secrets sequentially within each provider group
            for (const [envVar, secretPath] of secretGroup.entries()) {
                try {
                    console.info(`Loading secret for ${envVar}: ${secretPath}`);
                    const secretValue = await provider.getSecret(secretPath);
                    secrets[envVar] = secretValue;
                } catch (error: unknown) {
                    const err = error instanceof Error ? error.message : String(error);
                    errors.push(new Error(`Failed to load secret for ${envVar} using ${secretPath}:\n- ${err}`));
                }
            }
        }));

        // If any errors occurred, throw them all together
        if (errors.length > 0) {
            throw new Error(errors.map(e => e.message).join('\n'));
        }

        return secrets;
    }
}
