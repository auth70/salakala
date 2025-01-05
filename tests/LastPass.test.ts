import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LastPassProvider } from '../src/lib/providers/LastPass.js';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('LastPassProvider', () => {
    let provider: LastPassProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new LastPassProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid LastPass secret path');
    });

    it('should retrieve secret successfully on first try', async () => {
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('lp://group/item-name');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith(
            'lpass show --password "group/item-name"',
            expect.any(Object)
        );
    });

    it('should attempt login and retry on first failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not logged in');
        });
        
        // Login succeeds (returns empty string as it only prints to stdout)
        vi.mocked(execSync).mockReturnValueOnce('');
        
        // Second attempt succeeds
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('lp://group/item-name');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith('lpass login --trust', expect.any(Object));
        expect(execSync).toHaveBeenCalledWith(
            'lpass show --password "group/item-name"',
            expect.any(Object)
        );
    });

    it('should handle empty secret value', async () => {
        vi.mocked(execSync).mockReturnValueOnce('');

        await expect(provider.getSecret('lp://group/item-name'))
            .rejects
            .toThrow('No value found for secret at path');
    });

    it('should handle login failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not logged in');
        });
        
        // Login fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Login failed');
        });

        await expect(provider.getSecret('lp://group/item-name'))
            .rejects
            .toThrow('Failed to read LastPass secret: Login failed');
    });
}); 