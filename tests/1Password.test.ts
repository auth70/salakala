import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnePasswordProvider } from '../src/lib/providers/1Password.js';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('OnePasswordProvider', () => {
    let provider: OnePasswordProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new OnePasswordProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid 1Password secret path');
    });

    it('should retrieve secret successfully on first try', async () => {
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('op://vault/item/field');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith(
            'op read "op://vault/item/field"',
            expect.any(Object)
        );
    });

    it('should attempt login and retry on first failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not signed in');
        });
        
        // Login succeeds with session token
        vi.mocked(execSync).mockReturnValueOnce('xyz-session-token\n');
        
        // Second attempt with session token succeeds
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('op://vault/item/field');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith('op signin --raw', expect.any(Object));
        expect(execSync).toHaveBeenCalledWith(
            'op read "op://vault/item/field" --session="xyz-session-token"',
            expect.any(Object)
        );
    });

    it('should handle empty secret value', async () => {
        // Mock execSync to return empty string
        vi.mocked(execSync).mockReturnValue('');

        await expect(provider.getSecret('op://vault/item/field'))
            .rejects
            .toThrow('No value found for secret at path');
    });

    it('should handle login failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not signed in');
        });
        
        // Login fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Login failed');
        });

        await expect(provider.getSecret('op://vault/item/field'))
            .rejects
            .toThrow('Failed to read 1Password secret: Login failed');
    });
}); 