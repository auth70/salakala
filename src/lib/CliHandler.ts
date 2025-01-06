import { spawn } from "child_process";

export class CliResponse {
    state: 'ok' | 'try-again' | 'error' | 'catastrophic';
    stdout: string;
    stderr: string;
    message?: string;
    error?: Error;
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

export class CliHandler {
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
    } = {}): Promise<CliResponse> {

        let errorValue: Error | null = null;
        const textDecoder = new TextDecoder();

        return new Promise((resolve, reject) => {
            console.log(`🔒🐟 Running command: ${command}`);

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

            child.stdout?.on('data', (data) => {
                if (options.interactive) {
                    process.stdout.write(data);
                }
                const line = textDecoder.decode(data);
                if (options.debug) {
                    console.log(`[spawn:stdout] ${line}`);
                }
                stdout += line;
                options.onStdout?.(line);
            });

            child.stderr?.on('data', (data) => {
                if (options.interactive) {
                    process.stderr.write(data);
                }
                const line = textDecoder.decode(data);
                if (options.debug) {
                    console.log(`[spawn:stderr] ${line}`);
                }
                stderr += line;
                options.onStderr?.(line);
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
                if (code === 0) {
                    resolve(new CliResponse({stdout, stderr, code: code || 0, state: 'ok', message: ''}));
                } else {
                    if (options.debug) {
                        console.log(`[spawn:close] Command failed with code ${code} and error: ${errorValue?.message}`);
                    }
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
