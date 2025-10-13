import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../src/lib/SyncManager.js';
import { OnePasswordProvider } from '../src/lib/providers/1Password.js';
import { GoogleCloudSecretsProvider } from '../src/lib/providers/GoogleCloudSecrets.js';
import { SecretProvider } from '../src/lib/SecretProvider.js';
import { writeFileSync, unlinkSync } from 'fs';

describe('SyncManager', () => {
    let syncManager: SyncManager;
    let providers: Map<string, SecretProvider>;
    let projectId: string;
    const createdSecrets: string[] = [];

    beforeEach(() => {
        if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
            throw new Error('OP_SERVICE_ACCOUNT_TOKEN environment variable must be set');
        }
        if (!process.env.GOOGLE_CLOUD_PROJECT) {
            throw new Error('GOOGLE_CLOUD_PROJECT environment variable must be set');
        }

        projectId = process.env.GOOGLE_CLOUD_PROJECT;

        providers = new Map<string, SecretProvider>([
            ['op://', new OnePasswordProvider()],
            ['gcsm://', new GoogleCloudSecretsProvider()],
        ]);

        syncManager = new SyncManager(providers);
    });

    afterEach(async () => {
        const gcpProvider = providers.get('gcsm://')!;
        for (const secretId of createdSecrets) {
            try {
                await gcpProvider.deleteSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            } catch (error) {
                // Ignore errors during cleanup
            }
        }
        createdSecrets.length = 0;
    });

    describe('Config detection', () => {
        it('should detect flat sync config', () => {
            const configPath = 'test-flat-sync-config.json';
            const config = {
                src: {
                    TEST_SECRET: 'op://testing/test-item/password'
                },
                dst: {
                    TEST_SECRET: [`gcsm://projects/${projectId}/secrets/test-sync-flat/versions/latest`]
                }
            };
            
            writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            const syncConfig = syncManager.loadSyncConfig(configPath);
            expect(syncConfig).not.toBeNull();
            expect(syncConfig?.src.TEST_SECRET).toBe('op://testing/test-item/password');
            expect(syncConfig?.dst.TEST_SECRET).toEqual([`gcsm://projects/${projectId}/secrets/test-sync-flat/versions/latest`]);
            
            unlinkSync(configPath);
        });

        it('should detect nested sync config', () => {
            const configPath = 'test-nested-sync-config.json';
            const config = {
                production: {
                    src: {
                        TEST_SECRET: 'op://testing/test-item/password'
                    },
                    dst: {
                        TEST_SECRET: [`gcsm://projects/${projectId}/secrets/test-sync-nested/versions/latest`]
                    }
                }
            };
            
            writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            const syncConfig = syncManager.loadSyncConfig(configPath, 'production');
            expect(syncConfig).not.toBeNull();
            expect(syncConfig?.src.TEST_SECRET).toBe('op://testing/test-item/password');
            expect(syncConfig?.dst.TEST_SECRET).toEqual([`gcsm://projects/${projectId}/secrets/test-sync-nested/versions/latest`]);
            
            unlinkSync(configPath);
        });

        it('should return null for non-sync config', () => {
            const configPath = 'test-regular-config.json';
            const config = {
                TEST_SECRET: 'op://testing/test-item/password'
            };
            
            writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            const syncConfig = syncManager.loadSyncConfig(configPath);
            expect(syncConfig).toBeNull();
            
            unlinkSync(configPath);
        });
    });

    describe('Sync operations', () => {
        it('should sync a single secret from 1Password to Google Cloud', async () => {
            const timestamp = Date.now();
            const secretId = `test-sync-single-${timestamp}`;
            createdSecrets.push(secretId);
            
            const syncConfig = {
                src: {
                    TEST_SECRET: 'op://testing/test-item/password'
                },
                dst: {
                    TEST_SECRET: [`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`]
                }
            };

            const results = await syncManager.sync(syncConfig, undefined, false, true);
            
            expect(results.length).toBe(1);
            expect(results[0].success).toBe(true);
            expect(results[0].secretName).toBe('TEST_SECRET');

            const gcpProvider = providers.get('gcsm://')!;
            const retrievedValue = await gcpProvider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            expect(retrievedValue).toBe('test-secret-value');
        }, 15000);

        it('should sync to multiple destinations', async () => {
            const timestamp = Date.now();
            const secretId1 = `test-sync-multi-1-${timestamp}`;
            const secretId2 = `test-sync-multi-2-${timestamp}`;
            createdSecrets.push(secretId1, secretId2);
            
            const syncConfig = {
                src: {
                    TEST_SECRET: 'op://testing/test-item/password'
                },
                dst: {
                    TEST_SECRET: [
                        `gcsm://projects/${projectId}/secrets/${secretId1}/versions/latest`,
                        `gcsm://projects/${projectId}/secrets/${secretId2}/versions/latest`
                    ]
                }
            };

            const results = await syncManager.sync(syncConfig, undefined, false, true);
            
            expect(results.length).toBe(2);
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(true);

            const gcpProvider = providers.get('gcsm://')!;
            const retrievedValue1 = await gcpProvider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId1}/versions/latest`);
            const retrievedValue2 = await gcpProvider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId2}/versions/latest`);
            expect(retrievedValue1).toBe('test-secret-value');
            expect(retrievedValue2).toBe('test-secret-value');
        }, 15000);

        it('should handle dry run mode', async () => {
            const timestamp = Date.now();
            const secretId = `test-sync-dry-run-${timestamp}`;
            
            const syncConfig = {
                src: {
                    TEST_SECRET: 'op://testing/test-item/password'
                },
                dst: {
                    TEST_SECRET: [`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`]
                }
            };

            const results = await syncManager.sync(syncConfig, undefined, true, true);
            
            expect(results.length).toBe(1);
            expect(results[0].success).toBe(true);

            const gcpProvider = providers.get('gcsm://')!;
            await expect(gcpProvider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`))
                .rejects
                .toThrow();
        });

        it('should sync only specific secret when specified', async () => {
            const timestamp = Date.now();
            const secretId1 = `test-sync-specific-1-${timestamp}`;
            const secretId2 = `test-sync-specific-2-${timestamp}`;
            createdSecrets.push(secretId1);
            // Note: secretId2 is not created, so we don't add it to cleanup
            
            const syncConfig = {
                src: {
                    SECRET_1: 'op://testing/test-item/password',
                    SECRET_2: 'op://testing/test-json/api-key'
                },
                dst: {
                    SECRET_1: [`gcsm://projects/${projectId}/secrets/${secretId1}/versions/latest`],
                    SECRET_2: [`gcsm://projects/${projectId}/secrets/${secretId2}/versions/latest`]
                }
            };

            const results = await syncManager.sync(syncConfig, 'SECRET_1', false, true);
            
            expect(results.length).toBe(1);
            expect(results[0].success).toBe(true);
            expect(results[0].secretName).toBe('SECRET_1');

            const gcpProvider = providers.get('gcsm://')!;
            const retrievedValue1 = await gcpProvider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId1}/versions/latest`);
            expect(retrievedValue1).toBe('test-secret-value');

            await expect(gcpProvider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId2}/versions/latest`))
                .rejects
                .toThrow();
        }, 15000);

        it('should handle errors when source secret not found', async () => {
            const syncConfig = {
                src: {
                    TEST_SECRET: 'op://testing/non-existent-item/password'
                },
                dst: {
                    TEST_SECRET: [`gcsm://projects/${projectId}/secrets/test-error/versions/latest`]
                }
            };

            const results = await syncManager.sync(syncConfig, undefined, false, true);
            
            expect(results.length).toBe(1);
            expect(results[0].success).toBe(false);
            expect(results[0].error).toBeDefined();
        });

        it('should handle missing source configuration', async () => {
            const syncConfig = {
                src: {
                    EXISTING_SECRET: 'op://testing/test-item/password'
                },
                dst: {
                    MISSING_SECRET: [`gcsm://projects/${projectId}/secrets/test-missing/versions/latest`]
                }
            };

            const results = await syncManager.sync(syncConfig, undefined, false, true);
            
            expect(results.length).toBe(1);
            expect(results[0].success).toBe(false);
            expect(results[0].error).toContain('not found in src configuration');
        });
    });

    describe('Summary printing', () => {
        it('should print summary without errors', () => {
            const results = [
                { secretName: 'SECRET_1', destination: 'dest1', success: true },
                { secretName: 'SECRET_2', destination: 'dest2', success: true }
            ];

            expect(() => syncManager.printSummary(results)).not.toThrow();
        });

        it('should print summary with errors', () => {
            const results = [
                { secretName: 'SECRET_1', destination: 'dest1', success: true },
                { secretName: 'SECRET_2', destination: 'dest2', success: false, error: 'Test error' }
            ];

            expect(() => syncManager.printSummary(results)).not.toThrow();
        });

        it('should print summary with skipped items', () => {
            const results = [
                { secretName: 'SECRET_1', destination: 'dest1', success: true },
                { secretName: 'SECRET_2', destination: 'dest2', success: true, skipped: true }
            ];

            expect(() => syncManager.printSummary(results)).not.toThrow();
        });
    });
});

