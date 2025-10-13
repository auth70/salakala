import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { BitwardenProvider } from '../src/lib/providers/Bitwarden.js';
import { parseEnvContent } from '../src/lib/ImportUtils.js';
import { simpleTestVars, jsonTestVars, standardJsonData, complexJsonData } from './fixtures/import-test-data.js';
import { generateTestId } from './test-utils.js';

describe('BitwardenProvider', () => {
    if (!process.env.BW_CLIENTID || !process.env.BW_CLIENTSECRET || !process.env.BW_PASSWORD) {
        throw new Error('BW_CLIENTID and BW_CLIENTSECRET and BW_PASSWORD environment variables must be set');
    }

    process.env.BW_SERVER = 'https://vault.bitwarden.eu';
    const provider = new BitwardenProvider();
    const createdItems: string[] = [];

    beforeAll(async () => {
        await provider.getItems();
    }, 30000);

    afterEach(async () => {
        for (const itemPath of createdItems) {
            try {
                await provider.deleteSecret(itemPath);
            } catch (error) {
                console.error('Error deleting Bitwarden item', error);
                // Continue with cleanup even if deletion fails
            }
        }
        createdItems.length = 0;
    });

    it('should retrieve a json notes field by key', async () => {
        const itemName = generateTestId('test-json-key');
        const path = `bw://${itemName}/notes`;
        createdItems.push(path);
        
        await provider.setSecret(path, JSON.stringify(complexJsonData));
        
        const result = await provider.getSecret(`${path}::foo`);
        expect(result).toBe(complexJsonData.foo);
    }, 60000);

    it('should retrieve a json notes field by complex key', async () => {
        const itemName = generateTestId('test-complex-key');
        const path = `bw://${itemName}/notes`;
        createdItems.push(path);
        
        await provider.setSecret(path, JSON.stringify(complexJsonData));
        
        const result = await provider.getSecret(`${path}::baz.lorem[1]`);
        expect(result).toBe(complexJsonData.baz.lorem[1]);
    }, 60000);

    it('should retrieve custom field by name', async () => {
        const itemName = generateTestId('test-custom-field');
        const testValue = 'test-secret-value';
        const path = `bw://${itemName}/test-field`;
        createdItems.push(path);
        
        await provider.setSecret(path, testValue);
        
        const result = await provider.getSecret(path);
        expect(result).toBe(testValue);
    }, 60000);

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid URI: invalid-path');
    });

    it('should handle non-existent item', async () => {
        await expect(provider.getSecret('bw://non-existent-item/password'))
            .rejects
            .toThrow('No item found with ID or name: non-existent-item');
    });

    it('should return item from a folder', async () => {
        const result = await provider.getSecret('bw://test-folder/test-folder-item/password');
        expect(result).toBe('password');
    });

    it('should return json field from a folder', async () => {
        const result = await provider.getSecret('bw://test-folder/test-folder-item/notes');
        expect(result).toBe('{"foo":"bar","baz":{"lorem":["ipsum","dolor"]}}');
    });

    it('should return json field from a folder by key', async () => {
        const result = await provider.getSecret('bw://test-folder/test-folder-item/notes::foo');
        expect(result).toBe('bar');
    });

    describe('Write operations', () => {
        it('should update an existing item', async () => {
            const itemName = generateTestId('test-update-item');
            const initialValue = `initial-${Date.now()}`;
            const updatedValue = `updated-${Date.now()}`;
            createdItems.push(`bw://test-folder/${itemName}/password`);
            
            await provider.setSecret(`bw://test-folder/${itemName}/password`, initialValue);
            const firstRead = await provider.getSecret(`bw://test-folder/${itemName}/password`);
            expect(firstRead).toBe(initialValue);
            
            await provider.setSecret(`bw://test-folder/${itemName}/password`, updatedValue);
            const secondRead = await provider.getSecret(`bw://test-folder/${itemName}/password`);
            expect(secondRead).toBe(updatedValue);
        }, 60000);

        it('should throw error for invalid path', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid URI: invalid-path');
        });

        it('should delete an item', async () => {
            const itemName = generateTestId('test-delete-item');
            const testValue = 'value-to-delete';
            
            await provider.setSecret(`bw://test-folder/${itemName}/password`, testValue);
            await provider.deleteSecret(`bw://test-folder/${itemName}/password`);
            
            await expect(provider.getSecret(`bw://test-folder/${itemName}/password`))
                .rejects
                .toThrow();
        }, 60000);
    });

    describe('buildPath', () => {
        it('should build path with folder, item, and field', () => {
            const path = provider.buildPath(
                { folder: 'my-folder', item: 'my-item' },
                { fieldName: 'api-key' }
            );
            expect(path).toBe('bw://my-folder/my-item/api-key');
        });

        it('should build path without folder', () => {
            const path = provider.buildPath(
                { item: 'my-item' },
                { fieldName: 'password' }
            );
            expect(path).toBe('bw://my-item/password');
        });

        it('should use default field name if not provided', () => {
            const path = provider.buildPath({
                folder: 'work',
                item: 'credentials'
            });
            expect(path).toBe('bw://work/credentials/password');
        });
    });

    describe('Import integration: JSON bundle storage', () => {
        it('should store and retrieve env vars as JSON bundle', async () => {
            const itemName = generateTestId('test-import-json');
            
            const testVars = { ...simpleTestVars, ...jsonTestVars };
            const jsonBundle = JSON.stringify(testVars);
            
            const bundlePath = provider.buildPath(
                { folder: 'test-folder', item: itemName },
                { fieldName: 'notes' }
            );
            createdItems.push(bundlePath);
            
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve and verify
            const retrieved = await provider.getSecret(bundlePath);
            const parsed = JSON.parse(retrieved);
            
            expect(parsed.API_KEY).toBe(simpleTestVars.API_KEY);
            expect(parsed.DB_PASSWORD).toBe(simpleTestVars.DB_PASSWORD);
            
            // Verify nested JSON
            const config = JSON.parse(parsed.CONFIG);
            expect(config.key).toBe('value');
            expect(config.number).toBe(42);
        }, 60000);

        it('should retrieve specific fields from JSON bundle using :: syntax', async () => {
            const itemName = generateTestId('test-import-json-field');
            
            const testVars = simpleTestVars;
            const jsonBundle = JSON.stringify(testVars);
            
            const bundlePath = provider.buildPath(
                { folder: 'test-folder', item: itemName },
                { fieldName: 'notes' }
            );
            createdItems.push(bundlePath);
            
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve specific fields using :: syntax
            const apiKey = await provider.getSecret(`${bundlePath}::API_KEY`);
            const dbPassword = await provider.getSecret(`${bundlePath}::DB_PASSWORD`);
            
            expect(apiKey).toBe(simpleTestVars.API_KEY);
            expect(dbPassword).toBe(simpleTestVars.DB_PASSWORD);
        }, 60000);
    });

    describe('Import integration: Individual fields storage', () => {
        it('should store and retrieve multiple fields in one item', async () => {
            const itemName = generateTestId('test-import-fields');
            
            const testVars = simpleTestVars;
            
            // Store each var as a separate field (using notes for custom fields)
            for (const [key, value] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { folder: 'test-folder', item: itemName },
                    { fieldName: key }
                );
                if (key === Object.keys(testVars)[0]) {
                    createdItems.push(`bw://test-folder/${itemName}/password`);
                }
                await provider.setSecret(path, value);
            }
            
            // Retrieve and verify each field
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { folder: 'test-folder', item: itemName },
                    { fieldName: key }
                );
                const retrieved = await provider.getSecret(path);
                expect(retrieved).toBe(expectedValue);
            }
        }, 60000);

        it('should store fields without folder', async () => {
            const itemName = generateTestId('test-import-no-folder');
            
            const testVars = simpleTestVars;
            
            // Store fields without folder
            for (const [key, value] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { item: itemName },
                    { fieldName: key }
                );
                if (key === Object.keys(testVars)[0]) {
                    createdItems.push(`bw://${itemName}/password`);
                }
                await provider.setSecret(path, value);
            }
            
            // Retrieve and verify
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { item: itemName },
                    { fieldName: key }
                );
                const retrieved = await provider.getSecret(path);
                expect(retrieved).toBe(expectedValue);
            }
        }, 60000);
    });

}, 30000); 