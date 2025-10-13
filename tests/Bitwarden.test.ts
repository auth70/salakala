import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { BitwardenProvider } from '../src/lib/providers/Bitwarden.js';

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
                // Ignore errors during cleanup
            }
        }
        createdItems.length = 0;
    });

    it('should retrieve password field by name', async () => {
        const result = await provider.getSecret(`bw://webtest/password`);
        expect(result).toBe('test-password-value');
    });

    it('should retrieve a json notes field', async () => {
        const result = await provider.getSecret(`bw://webtest/notes`);
        expect(result).toBe('{"foo":"bar","baz":{"lorem":["ipsum","dolor"]}}');
    });

    it('should retrieve a json notes field by key', async () => {
        const result = await provider.getSecret(`bw://webtest/notes::foo`);
        expect(result).toBe('bar');
    });

    it('should retrieve a json notes field by complex key', async () => {
        const result = await provider.getSecret(`bw://webtest/notes::baz.lorem[1]`);
        expect(result).toBe('dolor');
    });

    it('should retrieve a uris field', async () => {
        const result = await provider.getSecret(`bw://webtest/uris/0`);
        expect(result).toBe('google.com');
    });

    it('should retrieve custom field by name', async () => {
        const result = await provider.getSecret(`bw://webtest/test-field`);
        expect(result).toBe('test-secret-value');
    });

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
        it('should write a new item to Bitwarden', async () => {
            const itemName = `test-write-item-${Date.now()}`;
            const testValue = `test-value-${Date.now()}`;
            createdItems.push(`bw://test-folder/${itemName}/password`);
            
            await provider.setSecret(`bw://test-folder/${itemName}/password`, testValue);
            
            const retrievedValue = await provider.getSecret(`bw://test-folder/${itemName}/password`);
            expect(retrievedValue).toBe(testValue);
        }, 15000);

        it('should update an existing item', async () => {
            const itemName = `test-update-item-${Date.now()}`;
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
            const itemName = `test-delete-item-${Date.now()}`;
            const testValue = 'value-to-delete';
            
            await provider.setSecret(`bw://test-folder/${itemName}/password`, testValue);
            await provider.deleteSecret(`bw://test-folder/${itemName}/password`);
            
            await expect(provider.getSecret(`bw://test-folder/${itemName}/password`))
                .rejects
                .toThrow();
        }, 60000);
    });

}, 30000); 