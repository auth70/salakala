import { spawn, SpawnOptionsWithoutStdio } from 'child_process';

export interface CliPasswordConfig {
    /**
     * The command to execute
     */
    command: string;

    /**
     * The arguments to pass to the command
     */
    args: string[];

    /**
     * Options to pass to the spawn function
     */
    options?: SpawnOptionsWithoutStdio;

    /**
     * The text that indicates a password prompt in stderr
     * @default "password"
     */
    promptText?: string | RegExp;

    /**
     * Function to transform the output before returning
     * @param output The raw output from stdout
     * @returns The transformed output
     */
    outputTransform?: (output: string) => string;

    /**
     * Custom error handler
     * @param code The exit code
     * @param stdout The stdout output
     * @param stderr The stderr output
     * @returns An error if the command failed, or undefined if it succeeded despite non-zero exit code
     */
    errorHandler?: (code: number | null, stdout: string, stderr: string) => Error | undefined;
}

/**
 * Utility class for handling CLI commands that may require password input.
 * Supports both interactive and programmatic password input.
 */
export class CliPasswordHandler {
    private password?: string;

    /**
     * Creates a new CliPasswordHandler
     * @param password Optional password for programmatic input
     */
    constructor(password?: string) {
        this.password = password;
    }

    /**
     * Executes a CLI command that may require password input
     * @param config The command configuration
     * @returns The command output
     */
    async execute(config: CliPasswordConfig): Promise<string> {
        const promptPattern = config.promptText instanceof RegExp 
            ? config.promptText 
            : new RegExp(config.promptText || 'password', 'i');

        return new Promise<string>((resolve, reject) => {
            const child = spawn(config.command, config.args, {
                ...config.options,
                stdio: this.password ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'pipe', 'inherit']
            });

            let stdout = '';
            let stderr = '';

            // Collect stdout
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            // Handle stderr and password prompt
            if (this.password) {
                child.stderr?.on('data', (data) => {
                    const text = data.toString();
                    if (promptPattern.test(text)) {
                        child.stdin?.write(this.password + '\n');
                    } else {
                        stderr += text;
                    }
                });
            }

            child.on('close', (code) => {
                // Allow custom error handling
                if (code !== 0 && config.errorHandler) {
                    const error = config.errorHandler(code, stdout, stderr);
                    if (error) {
                        reject(error);
                        return;
                    }
                } else if (code !== 0) {
                    reject(new Error(stderr || `Command failed with exit code ${code}`));
                    return;
                }

                const output = stdout.trim();
                if (!output) {
                    reject(new Error('No output received from command'));
                    return;
                }

                resolve(config.outputTransform ? config.outputTransform(output) : output);
            });

            child.on('error', (error) => {
                reject(new Error(`Failed to execute command: ${error.message}`));
            });
        });
    }

    /**
     * Creates a new handler with a different password
     * @param password The new password
     * @returns A new CliPasswordHandler instance
     */
    withPassword(password: string): CliPasswordHandler {
        return new CliPasswordHandler(password);
    }
} 