import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubSecretsProvider } from '../src/lib/providers/GitHubSecrets.js';
import { execSync } from 'child_process';

vi.mock('child_process');

describe('GitHubSecretsProvider', () => {
    let provider: GitHubSecretsProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GitHubSecretsProvider();
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid GitHub secret path');
    });

    it('should throw error for incomplete path', async () => {
        await expect(provider.getSecret('ghs://owner/repo'))
            .rejects
            .toThrow('Invalid GitHub secret path format. Expected: ghs://owner/repo/secret-name');
    });

    it('should retrieve secret successfully', async () => {
        vi.mocked(execSync).mockReturnValueOnce('test-secret-value\n');

        const result = await provider.getSecret('ghs://auth70/salakala/API_KEY');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith(
            'gh secret list -R auth70/salakala --json name,value | jq -r \'.[] | select(.name=="API_KEY") | .value\'',
            expect.any(Object)
        );
    });

    it('should handle empty secret value', async () => {
        vi.mocked(execSync).mockReturnValueOnce('\n');

        await expect(provider.getSecret('ghs://auth70/salakala/API_KEY'))
            .rejects
            .toThrow('No value found for secret \'API_KEY\' in repository \'auth70/salakala\'');
    });

    it('should attempt login on first failure', async () => {
        // First call fails
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('Not logged in');
        });
        
        // Login succeeds
        vi.mocked(execSync).mockImplementationOnce(() => '');
        
        // Second attempt succeeds
        vi.mocked(execSync).mockImplementationOnce(() => 'test-secret-value\n');

        const result = await provider.getSecret('ghs://auth70/salakala/API_KEY');
        
        expect(result).toBe('test-secret-value');
        expect(execSync).toHaveBeenCalledWith('gh auth login', expect.any(Object));
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

        await expect(provider.getSecret('ghs://auth70/salakala/API_KEY'))
            .rejects
            .toThrow('Failed to read GitHub secret: Login failed');
    });

    it('should handle non-existent secret', async () => {
        vi.mocked(execSync).mockReturnValueOnce('\n');

        await expect(provider.getSecret('ghs://auth70/salakala/NONEXISTENT_KEY'))
            .rejects
            .toThrow('No value found for secret \'NONEXISTENT_KEY\' in repository \'auth70/salakala\'');
    });

    it('should handle repository access error', async () => {
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('could not read repository auth70/private-repo: not found');
        });

        await expect(provider.getSecret('ghs://auth70/private-repo/SECRET'))
            .rejects
            .toThrow('Failed to read GitHub secret: Repository access denied');
    });
}); 