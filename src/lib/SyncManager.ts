import { readFileSync } from 'fs';
import { SecretProvider } from './SecretProvider.js';
import { select } from '@inquirer/prompts';

/**
 * Configuration structure for sync operations
 */
export interface SyncConfig {
    src: Record<string, string>;
    dst: Record<string, string | string[]>;
}

/**
 * Result of a sync operation for a single secret
 */
interface SyncResult {
    secretName: string;
    destination: string;
    success: boolean;
    error?: string;
    skipped?: boolean;
}

/**
 * Manages synchronization of secrets between providers.
 * Handles loading sync configurations, fetching from source providers,
 * and writing to destination providers with conflict resolution.
 */
export class SyncManager {
    private providers: Map<string, SecretProvider>;

    /**
     * Initializes a new SyncManager with the given provider map.
     * 
     * @param {Map<string, SecretProvider>} providers - Map of provider prefixes to provider instances
     */
    constructor(providers: Map<string, SecretProvider>) {
        this.providers = providers;
    }

    /**
     * Checks if a config object has the src/dst structure for syncing.
     * 
     * @param {any} config - The config object to check
     * @returns {boolean} True if the config has both src and dst keys
     */
    private isSyncConfig(config: any): boolean {
        return config && 
               typeof config === 'object' && 
               'src' in config && 
               'dst' in config &&
               typeof config.src === 'object' &&
               typeof config.dst === 'object';
    }

    /**
     * Loads sync configuration from a file.
     * Supports both flat configs and environment-nested configs.
     * 
     * @param {string} configPath - Path to the configuration file
     * @param {string} [environment] - Environment name for nested configs
     * @returns {SyncConfig | null} The sync configuration or null if not a sync config
     * @throws {Error} If the config file is invalid or environment not found
     */
    loadSyncConfig(configPath: string, environment?: string): SyncConfig | null {
        const configContent = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        if (this.isSyncConfig(config)) {
            return config as SyncConfig;
        }

        if (environment && config[environment] && this.isSyncConfig(config[environment])) {
            return config[environment] as SyncConfig;
        }

        return null;
    }

    /**
     * Gets the provider for a given secret path.
     * 
     * @param {string} path - The secret path
     * @returns {SecretProvider | null} The provider instance or null if not found
     */
    private getProviderForPath(path: string): SecretProvider | null {
        const prefix = Array.from(this.providers.keys()).find(p => path.startsWith(p));
        return prefix ? this.providers.get(prefix)! : null;
    }

    /**
     * Prompts the user for conflict resolution.
     * 
     * @param {string} secretName - Name of the secret
     * @param {string} destination - Destination path
     * @param {string} sourceValue - New value from source
     * @param {SecretProvider} destProvider - Destination provider for fetching current value
     * @returns {Promise<'overwrite' | 'skip' | 'overwrite-all' | 'quit'>} User's choice
     */
    private async promptConflict(
        secretName: string,
        destination: string,
        sourceValue: string,
        destProvider: SecretProvider
    ): Promise<'overwrite' | 'skip' | 'overwrite-all' | 'quit'> {
        const action = await select({
            message: `Secret '${secretName}' already exists at '${destination}'. What would you like to do?`,
            choices: [
                { name: 'Overwrite this secret', value: 'overwrite' },
                { name: 'Skip this secret', value: 'skip' },
                { name: 'Show diff', value: 'diff' },
                { name: 'Overwrite all remaining conflicts', value: 'overwrite-all' },
                { name: 'Quit', value: 'quit' }
            ]
        });

        if (action === 'diff') {
            try {
                const currentValue = await destProvider.getSecret(destination);
                console.log('\n--- Current value (destination) ---');
                console.log(currentValue.substring(0, 200) + (currentValue.length > 200 ? '...' : ''));
                console.log('\n--- New value (source) ---');
                console.log(sourceValue.substring(0, 200) + (sourceValue.length > 200 ? '...' : ''));
                console.log('');
            } catch (error) {
                console.log(`Could not fetch current value: ${error instanceof Error ? error.message : String(error)}`);
            }
            return this.promptConflict(secretName, destination, sourceValue, destProvider);
        }

        return action as 'overwrite' | 'skip' | 'overwrite-all' | 'quit';
    }

    /**
     * Checks if a secret exists at the destination.
     * 
     * @param {SecretProvider} provider - The provider to check
     * @param {string} path - The secret path
     * @returns {Promise<boolean>} True if the secret exists
     */
    private async secretExists(provider: SecretProvider, path: string): Promise<boolean> {
        try {
            await provider.getSecret(path);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Synchronizes secrets from source to destination(s) based on sync configuration.
     * 
     * @param {SyncConfig} syncConfig - The sync configuration
     * @param {string} [specificSecret] - Optional: sync only this specific secret
     * @param {boolean} [dryRun=false] - If true, only show what would be synced
     * @param {boolean} [skipPrompts=false] - If true, skip conflict prompts and overwrite
     * @returns {Promise<SyncResult[]>} Array of sync results
     */
    async sync(
        syncConfig: SyncConfig,
        specificSecret?: string,
        dryRun: boolean = false,
        skipPrompts: boolean = false
    ): Promise<SyncResult[]> {
        const results: SyncResult[] = [];
        let overwriteAll = false;

        const secretsToSync = specificSecret
            ? [specificSecret]
            : Object.keys(syncConfig.dst);

        for (const secretName of secretsToSync) {
            if (!syncConfig.src[secretName]) {
                results.push({
                    secretName,
                    destination: 'N/A',
                    success: false,
                    error: `Secret '${secretName}' not found in src configuration`
                });
                continue;
            }

            if (!syncConfig.dst[secretName]) {
                results.push({
                    secretName,
                    destination: 'N/A',
                    success: false,
                    error: `Secret '${secretName}' not found in dst configuration`
                });
                continue;
            }

            const sourcePath = syncConfig.src[secretName];
            const sourceProvider = this.getProviderForPath(sourcePath);

            if (!sourceProvider) {
                results.push({
                    secretName,
                    destination: 'N/A',
                    success: false,
                    error: `No provider found for source path: ${sourcePath}`
                });
                continue;
            }

            let sourceValue: string;
            try {
                console.log(`🔒 Fetching ${secretName} from ${sourcePath}`);
                sourceValue = await sourceProvider.getSecret(sourcePath);
            } catch (error) {
                results.push({
                    secretName,
                    destination: 'N/A',
                    success: false,
                    error: `Failed to fetch from source: ${error instanceof Error ? error.message : String(error)}`
                });
                continue;
            }

            const destinations = Array.isArray(syncConfig.dst[secretName])
                ? syncConfig.dst[secretName] as string[]
                : [syncConfig.dst[secretName] as string];

            for (const destination of destinations) {
                const destProvider = this.getProviderForPath(destination);

                if (!destProvider) {
                    results.push({
                        secretName,
                        destination,
                        success: false,
                        error: `No provider found for destination path: ${destination}`
                    });
                    continue;
                }

                if (dryRun) {
                    console.log(`[DRY RUN] Would sync ${secretName} to ${destination}`);
                    results.push({
                        secretName,
                        destination,
                        success: true
                    });
                    continue;
                }

                const exists = await this.secretExists(destProvider, destination);

                if (exists && !skipPrompts && !overwriteAll) {
                    const choice = await this.promptConflict(secretName, destination, sourceValue, destProvider);
                    
                    if (choice === 'quit') {
                        console.log('Sync operation cancelled by user');
                        return results;
                    }
                    
                    if (choice === 'skip') {
                        console.log(`⏭️  Skipping ${secretName} → ${destination}`);
                        results.push({
                            secretName,
                            destination,
                            success: true,
                            skipped: true
                        });
                        continue;
                    }
                    
                    if (choice === 'overwrite-all') {
                        overwriteAll = true;
                    }
                }

                try {
                    console.log(`📝 Writing ${secretName} to ${destination}`);
                    await destProvider.setSecret(destination, sourceValue);
                    results.push({
                        secretName,
                        destination,
                        success: true
                    });
                    console.log(`✅ Successfully synced ${secretName} to ${destination}`);
                } catch (error) {
                    results.push({
                        secretName,
                        destination,
                        success: false,
                        error: `Failed to write to destination: ${error instanceof Error ? error.message : String(error)}`
                    });
                    console.error(`❌ Failed to sync ${secretName} to ${destination}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        return results;
    }

    /**
     * Prints a summary of sync results.
     * 
     * @param {SyncResult[]} results - Array of sync results
     */
    printSummary(results: SyncResult[]): void {
        const successful = results.filter(r => r.success && !r.skipped).length;
        const failed = results.filter(r => !r.success).length;
        const skipped = results.filter(r => r.skipped).length;
        const total = results.length;

        console.log('\n' + '='.repeat(50));
        console.log('Sync Summary:');
        console.log(`  Total operations: ${total}`);
        console.log(`  ✅ Successful: ${successful}`);
        console.log(`  ⏭️  Skipped: ${skipped}`);
        console.log(`  ❌ Failed: ${failed}`);
        console.log('='.repeat(50));

        if (failed > 0) {
            console.log('\nFailed operations:');
            results.filter(r => !r.success).forEach(r => {
                console.log(`  - ${r.secretName} → ${r.destination}: ${r.error}`);
            });
        }
    }
}

