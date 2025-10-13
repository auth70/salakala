import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OnePasswordProvider } from '../src/lib/providers/1Password.js';
import { parseEnvContent } from '../src/lib/ImportUtils.js';
import { testEnvContent, expectedParsedValues, simpleTestVars, jsonTestVars, standardJsonData, complexJsonData, nestedJsonData } from './fixtures/import-test-data.js';
import { generateTestId } from './test-utils.js';

describe('OnePasswordProvider', () => {
    let provider: OnePasswordProvider;
    const createdItems: string[] = [];

    beforeEach(async () => {
        if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
            throw new Error('OP_SERVICE_ACCOUNT_TOKEN environment variable must be set');
        }
        provider = new OnePasswordProvider();
        // Rate limit: wait between tests to avoid 1Password API throttling and ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 3000));
    });

    afterEach(async () => {
        const hadItems = createdItems.length > 0;
        for (const itemPath of createdItems) {
            try {
                await provider.deleteSecret(itemPath);
                // Delay between deletions to avoid rate limiting and 409 conflicts
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error('Error deleting 1Password item', error);
                // Ignore errors during cleanup
            }
        }
        createdItems.length = 0;
        // Additional delay after cleanup to ensure 1Password processes deletions
        if (hadItems) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid 1Password secret path');
    });

    it('should retrieve JSON secret with :: syntax', async () => {
        const itemName = generateTestId('test-json-syntax');
        const path = `op://testing/${itemName}/notes`;
        createdItems.push(path);
        
        await provider.setSecret(path, JSON.stringify(standardJsonData));
        
        const result = await provider.getSecret(`${path}::key`);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe(standardJsonData.key);
    }, 15000);

    it('should retrieve nested JSON secret with :: syntax', async () => {
        const itemName = generateTestId('test-nested-json');
        const path = `op://testing/${itemName}/notes`;
        createdItems.push(path);
        
        await provider.setSecret(path, JSON.stringify(standardJsonData));
        
        const result = await provider.getSecret(`${path}::nested.value`);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe(standardJsonData.nested.value);
    }, 15000);

    it('should throw on non-existent JSON key with :: syntax', async () => {
        const itemName = generateTestId('test-missing-key');
        const path = `op://testing/${itemName}/notes`;
        createdItems.push(path);
        
        await provider.setSecret(path, JSON.stringify(standardJsonData));
        
        await expect(provider.getSecret(`${path}::nonExistentKey`))
            .rejects
            .toThrow(/Key nonExistentKey not found in JSON object/);
    }, 15000);

    it('should throw on non-existent vault', async () => {
        await expect(provider.getSecret('op://non-existent-vault/item/field'))
            .rejects
            .toThrow(/Failed to read 1Password secret/);
    });

    it('should throw on non-existent item', async () => {
        await expect(provider.getSecret('op://testing/non-existent-item/field'))
            .rejects
            .toThrow(/Failed to read 1Password secret/);
    });

    it('should throw on non-existent field', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const itemName = generateTestId('test-missing-field');
        const path = `op://testing/${itemName}/password`;
        createdItems.push(path);
        
        await provider.setSecret(path, 'test-value');
        
        await expect(provider.getSecret(`op://testing/${itemName}/non-existent-field`))
            .rejects
            .toThrow(/Failed to read 1Password secret/);
    }, 15000);

    describe('Write operations', () => {
        it('should update an existing secret', async () => {
            const itemName = generateTestId('test-update-item');
            const initialValue = `initial-${Date.now()}`;
            const updatedValue = `updated-${Date.now()}`;
            createdItems.push(`op://testing/${itemName}/password`);
            
            await provider.setSecret(`op://testing/${itemName}/password`, initialValue);
            const firstRead = await provider.getSecret(`op://testing/${itemName}/password`);
            expect(firstRead).toBe(initialValue);
            
            // Add small delay to avoid 409 conflicts from rapid updates
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            await provider.setSecret(`op://testing/${itemName}/password`, updatedValue);
            const secondRead = await provider.getSecret(`op://testing/${itemName}/password`);
            expect(secondRead).toBe(updatedValue);
        }, 20000);

        it('should throw error for invalid write path', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid 1Password secret path');
        });

        it('should throw error for path without field name', async () => {
            await expect(provider.setSecret('op://testing/item', 'value'))
                .rejects
                .toThrow('1Password path must include a field name');
        });

        it('should delete a secret', async () => {
            const itemName = generateTestId('test-delete-item');
            const testValue = `value-to-delete-${Date.now()}`;
            
            await provider.setSecret(`op://testing/${itemName}/password`, testValue);
            
            // Add small delay to ensure item is fully created before deletion
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            await provider.deleteSecret(`op://testing/${itemName}/password`);
            
            await expect(provider.getSecret(`op://testing/${itemName}/password`))
                .rejects
                .toThrow();
        }, 20000);
    });

    describe('buildPath', () => {
        it('should build path with vault, item, and field', () => {
            const path = provider.buildPath(
                { vault: 'my-vault', item: 'my-item' },
                { fieldName: 'password' }
            );
            expect(path).toBe('op://my-vault/my-item/password');
        });

        it('should build path with section', () => {
            const path = provider.buildPath(
                { vault: 'my-vault', item: 'my-item', section: 'credentials' },
                { fieldName: 'api-key' }
            );
            expect(path).toBe('op://my-vault/my-item/credentials/api-key');
        });

        it('should use default field name if not provided', () => {
            const path = provider.buildPath({
                vault: 'my-vault',
                item: 'my-item'
            });
            expect(path).toBe('op://my-vault/my-item/value');
        });
    });

    describe('Import integration: JSON bundle storage', () => {
        it('should debug what gets stored and retrieved', async () => {
            const itemName = generateTestId('test-debug-json');
            
            // Simple test data
            const testData = {
                KEY1: 'value1',
                KEY2: 'value2'
            };
            
            const jsonBundle = JSON.stringify(testData);
            console.log('Original JSON bundle:', jsonBundle);
            
            const bundlePath = provider.buildPath(
                { vault: 'testing', item: itemName },
                { fieldName: 'config' }
            );
            createdItems.push(bundlePath);
            
            // Store
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve
            const retrieved = await provider.getSecret(bundlePath);
            console.log('Retrieved value:', retrieved);
            console.log('Retrieved value type:', typeof retrieved);
            console.log('Retrieved value length:', retrieved.length);
            console.log('First 100 chars:', retrieved.substring(0, 100));
            
            // Try to parse
            try {
                const parsed = JSON.parse(retrieved);
                console.log('Parsed successfully:', parsed);
                expect(parsed.KEY1).toBe('value1');
            } catch (e) {
                console.error('Parse error:', e);
                throw e;
            }
        }, 20000);

        it('should store and retrieve env vars as JSON bundle', async () => {
            const itemName = generateTestId('test-import-json');
            
            // Parse test env content
            const envVars = parseEnvContent(testEnvContent);
            
            // Create JSON bundle
            const jsonBundle = JSON.stringify(envVars);
            const bundlePath = provider.buildPath(
                { vault: 'testing', item: itemName },
                { fieldName: 'config' }
            );
            createdItems.push(bundlePath);
            
            // Store bundle
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve and verify
            const retrieved = await provider.getSecret(bundlePath);
            const parsed = JSON.parse(retrieved);
            
            expect(parsed.SIMPLE_VALUE).toBe(expectedParsedValues.SIMPLE_VALUE);
            expect(parsed.DATABASE_URL).toBe(expectedParsedValues.DATABASE_URL);
            expect(parsed.ENCODED_VALUE).toBe(expectedParsedValues.ENCODED_VALUE);
            
            // Verify nested JSON survived the round-trip
            const jsonConfig = JSON.parse(parsed.JSON_CONFIG);
            expect(jsonConfig.database.host).toBe('localhost');
            expect(jsonConfig.api.endpoint).toBe('https://api.example.com/v1');
        }, 20000);

        it('should retrieve specific fields from JSON bundle using :: syntax', async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const itemName = generateTestId('test-import-json-field');
            
            const envVars = parseEnvContent(testEnvContent);
            const jsonBundle = JSON.stringify(envVars);
            const bundlePath = provider.buildPath(
                { vault: 'testing', item: itemName },
                { fieldName: 'config' }
            );
            createdItems.push(bundlePath);
            
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve specific fields using :: syntax
            const simpleValue = await provider.getSecret(`${bundlePath}::SIMPLE_VALUE`);
            const dbUrl = await provider.getSecret(`${bundlePath}::DATABASE_URL`);
            const jsonConfig = await provider.getSecret(`${bundlePath}::JSON_CONFIG`);
            
            expect(simpleValue).toBe(expectedParsedValues.SIMPLE_VALUE);
            expect(dbUrl).toBe(expectedParsedValues.DATABASE_URL);
            
            // Verify nested JSON is still valid
            const parsed = JSON.parse(jsonConfig);
            expect(parsed.database.host).toBe('localhost');
        }, 20000);

        it('should handle JSON inside JSON bundle', async () => {
            const itemName = generateTestId('test-import-nested-json');
            
            const jsonBundle = JSON.stringify(nestedJsonData);
            const bundlePath = provider.buildPath(
                { vault: 'testing', item: itemName },
                { fieldName: 'data' }
            );
            createdItems.push(bundlePath);
            
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve the outer JSON field
            const outerJson = await provider.getSecret(`${bundlePath}::OUTER_JSON`);
            expect(typeof outerJson).toBe('string');
            
            // Parse and verify the inner structure
            const parsed = JSON.parse(outerJson);
            expect(parsed.inner.nested).toBe('value');
            expect(parsed.array).toEqual([1, 2, 3]);
        }, 20000);
    });

    describe('Import integration: Individual fields storage', () => {
        it('should store and retrieve multiple fields in one item', async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const itemName = generateTestId('test-import-fields');
            
            const testVars = simpleTestVars;
            
            // Store each var as a separate field
            for (const [key, value] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { vault: 'testing', item: itemName },
                    { fieldName: key }
                );
                if (key === Object.keys(testVars)[0]) {
                    createdItems.push(`op://testing/${itemName}/password`); // For cleanup
                }
                await provider.setSecret(path, value);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Retrieve and verify each field
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { vault: 'testing', item: itemName },
                    { fieldName: key }
                );
                const retrieved = await provider.getSecret(path);
                expect(retrieved).toBe(expectedValue);
            }
        }, 20000);

        it('should store fields with sections', async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const itemName = generateTestId('test-import-sections');
            
            const testVars = simpleTestVars;
            
            // Store fields in a section
            for (const [key, value] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { vault: 'testing', item: itemName, section: 'credentials' },
                    { fieldName: key }
                );
                if (key === Object.keys(testVars)[0]) {
                    createdItems.push(`op://testing/${itemName}/password`);
                }
                await provider.setSecret(path, value);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Retrieve and verify
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { vault: 'testing', item: itemName, section: 'credentials' },
                    { fieldName: key }
                );
                const retrieved = await provider.getSecret(path);
                expect(retrieved).toBe(expectedValue);
            }
        }, 20000);

        it('should store JSON values as individual fields', async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const itemName = generateTestId('test-import-json-fields');
            
            const testVars = jsonTestVars;
            
            // Store JSON values as separate fields
            for (const [key, value] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { vault: 'testing', item: itemName },
                    { fieldName: key }
                );
                if (key === Object.keys(testVars)[0]) {
                    createdItems.push(`op://testing/${itemName}/password`);
                }
                await provider.setSecret(path, value);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Retrieve and verify JSON is still valid
            // Note: 1Password may strip quotes from JSON when storing in fields,
            // so we parse it flexibly
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath(
                    { vault: 'testing', item: itemName },
                    { fieldName: key }
                );
                const retrieved = await provider.getSecret(path);
                
                // Verify it parses correctly (might have stripped quotes)
                const parsed = JSON.parse(retrieved);
                expect(parsed).toBeDefined();
                
                // Verify structure is preserved
                const expected = JSON.parse(expectedValue);
                expect(parsed).toEqual(expected);
            }
        }, 20000);
    });
}); 