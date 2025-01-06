import { spawn } from "child_process";

/**
 * Represents the result of a CLI command execution
 * @class CliResponse
 */
export class CliResponse {
    /** Final state of the command execution */
    state: 'ok' | 'try-again' | 'error' | 'catastrophic';
    /** Standard output from the command */
    stdout: string;
    /** Standard error output from the command */
    stderr: string;
    /** Optional message providing additional context */
    message?: string;
    /** Original error object if an error occurred */
    error?: Error;
    /** Exit code from the command */
    code: number;

    constructor({
        stdout, stderr, code, state, message, error}: {
        stdout: string,
        stderr: string,
        code: number,
        state: 'ok' | 'try-again' | 'error' | 'catastrophic',
        message?: string,
        error?: Error
    }) {
        this.stdout = stdout;
        this.stderr = stderr;
        this.code = code;
        this.state = state;
        this.message = message;
        this.error = error;
    }
}

/**
 * Sanitizes command strings by censoring sensitive session information
 * @param str - The command string to sanitize
 * @returns The sanitized command string
 */
function censor(str: string) {
    // Censor things in `--session=""` to prevent logging sensitive data
    return str.replace(/--session="[^"]*"/g, '--session="****"');
}

/**
 * Prunes annoying punycode warning from Google Cloud SDK output
 * @param str - The string to prune
 * @returns The pruned string
 */
function prune(str: string) {
    const pruneMessages = [
        /\(node:.*\) \[DEP0040\] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.\n/g,
        /\(Use `node --trace-deprecation ...` to show where the warning was created\)\n/g
    ];
    return str.replaceAll(pruneMessages[0], '').replaceAll(pruneMessages[1], '');
}

/**
 * Handles execution of CLI commands with advanced error handling and output control
 * @class CliHandler
 */
export class CliHandler {
    /**
     * Executes a CLI command with configurable options
     * @param command - The command to execute
     * @param options - Configuration options for command execution
     * @param options.env - Additional environment variables
     * @param options.interactive - Whether to pipe input/output to parent process
     * @param options.stdio - Custom stdio configuration
     * @param options.expectedSuccess - Regex patterns indicating successful output
     * @param options.expectedFailure - Regex patterns indicating expected failures
     * @param options.onStdout - Callback for stdout data
     * @param options.onStderr - Callback for stderr data
     * @param options.onClose - Callback for process close
     * @param options.debug - Enable debug logging
     * @param options.passwordPrompt - String pattern indicating a password prompt, after which output should be censored
     * @param options.password - Password to input when passwordPrompt is detected (for non-interactive mode)
     * @returns Promise<CliResponse> - Resolution of command execution
     */
    run(command: string, options: {
        env?: NodeJS.ProcessEnv;
        interactive?: boolean;
        stdio?: 'pipe' | 'inherit' | Array<'pipe' | 'inherit' | null>;
        expectedSuccess?: Array<RegExp>;
        expectedFailure?: Array<RegExp>;
        onStdout?: (data: string) => void;
        onStderr?: (data: string) => void;
        onClose?: (code: number) => void;
        debug?: boolean;
        passwordPrompt?: string;
        password?: string;
    } = {}): Promise<CliResponse> {

        let errorValue: Error | null = null;
        let passwordPromptSeen = false;
        let userInputSeen = false;
        let passwordSent = false;
        const textDecoder = new TextDecoder();
        const textEncoder = new TextEncoder();

        return new Promise((resolve, reject) => {
            console.log(`✨ Running: ${censor(command)}`);

            // Spawn process with inherited TTY settings for proper color support
            const child = spawn(command, {
                shell: true,
                stdio: options.interactive ? ['inherit', 'pipe', 'pipe'] : (options.stdio ?? 'pipe'),
                env: {
                    ...process.env,
                    FORCE_COLOR: process.stdout.isTTY ? '1' : '0',
                    COLORTERM: process.env.COLORTERM,
                    TERM: process.env.TERM,
                    ...options.env
                }
            });

            let stdout = '', stderr = '';
            let lineAtPasswordPrompt = '';

            function handleStd(data: Buffer, type: 'stdout' | 'stderr') {
                const prunedData = prune(textDecoder.decode(data));
                let line = prunedData;
                if (options.debug) {
                    console.log(`[spawn:${type}] ${line}`);
                }
                // Handle password input in non-interactive mode
                if (
                    !options.interactive &&
                    options.passwordPrompt &&
                    options.password && 
                    line.includes(options.passwordPrompt) &&
                    !passwordSent
                ) {
                    child.stdin?.write(options.password + '\n');
                    passwordSent = true;
                    return;
                }

                if(!options.interactive) {
                    type === 'stdout' ? stdout += line : stderr += line;
                    type === 'stdout' ? options.onStdout?.(line) : options.onStderr?.(line);
                    return;
                } else {
                    // Check for password prompt
                    if (options.passwordPrompt && line.includes(options.passwordPrompt)) {
                        if(options.debug) console.log(`🐛 Password prompt seen in ${type}: ${options.passwordPrompt}`);
                        passwordPromptSeen = true;
                        lineAtPasswordPrompt = line;
                    }
                    // If we've seen a password prompt and this is a new line (likely user input)
                    if (passwordPromptSeen && !userInputSeen && line !== lineAtPasswordPrompt) {
                        userInputSeen = true;
                        if(options.debug) console.log(`🐛 User input seen in ${type}: ${line}`);
                    }
                    // Censor output after password prompt and user input
                    if (passwordPromptSeen && userInputSeen && !line.includes(options.passwordPrompt || '')) {
                        if(options.debug) console.log(`🐛 Censoring output after password prompt and user input`);
                        line = '';
                    }
                    type === 'stdout' ? process.stdout.write(textEncoder.encode(line)) : process.stderr.write(textEncoder.encode(line));
                    if(!passwordPromptSeen && !userInputSeen) {
                        if(options.debug) console.log(`🐛 Adding to ${type}: ${line}`);
                        type === 'stdout' ? stdout += line : stderr += line;
                        type === 'stdout' ? options.onStdout?.(line) : options.onStderr?.(line);
                    } else {
                        if(options.debug) console.log(`🐛 Adding to ${type}: ${prunedData}`);
                        type === 'stdout' ? stdout += prunedData : stderr += prunedData;
                        type === 'stdout' ? options.onStdout?.(prunedData) : options.onStderr?.(prunedData);
                    }
                }
            }

            child.stdout?.on('data', (data) => {
                handleStd(data, 'stdout');
            });

            child.stderr?.on('data', (data) => {
                handleStd(data, 'stderr');
            });

            if (options.debug) {
                console.log(`Waiting for command to finish...`);
            }

            child.on('error', (error) => {
                if (options.debug) {
                    console.log(`[spawn:error] Command failed with error: ${error}`);
                }
                errorValue = error;
            });

            child.on('close', (code) => {
                if (options.debug) {
                    console.log(`[spawn:close] Command finished with code ${code}`);
                    console.log(`[spawn:close] stdout: ${stdout}`);
                    console.log(`[spawn:close] stderr: ${stderr}`);
                }
                
                // Handle different exit scenarios
                if (code === 0) {
                    resolve(new CliResponse({stdout, stderr, code: code || 0, state: 'ok', message: ''}));
                } else {
                    // Handle specific error cases with descriptive messages
                    if(errorValue && errorValue.message.includes('ENOENT')) {
                        resolve(new CliResponse({stdout, stderr, code: code || 0, state: 'catastrophic', message: `Command not found: ${command}`, error: errorValue}));
                    } else if(errorValue && errorValue.message.includes('EACCES')) {
                        resolve(new CliResponse({stdout, stderr, code: code || 0, state: 'catastrophic', message: `Command not executable or permission denied: ${command}`, error: errorValue}));
                    } else if(errorValue && errorValue.message.includes('ECONNREFUSED')) {
                        resolve(new CliResponse({stdout, stderr, code: code || 0, state: 'catastrophic', message: `Command refused connection: ${command}`, error: errorValue}));
                    } else if(errorValue && errorValue.message.includes('ECONNRESET')) {
                        resolve(new CliResponse({stdout, stderr, code: code || 0, state: 'catastrophic', message: `Command connection reset: ${command}`, error: errorValue}));
                    } else {
                        resolve(new CliResponse({stdout, stderr, code: code ?? 1, state: 'error', message: errorValue?.message ?? stderr}));
                    }
                }
            });
        });
    }
}
