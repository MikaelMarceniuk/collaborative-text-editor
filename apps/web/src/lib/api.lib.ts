const API_URL = 'http://localhost:3333/api';

export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const throwApiError = async (response: Response): Promise<never> => {
	const body: { error?: string } | null = await response.json().catch(() => null);
	throw new ApiError(response.status, body?.error ?? response.statusText);
};

export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
	const response = await fetch(`${API_URL}${path}`, {
		...init,
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...init?.headers },
	});

	if (!response.ok) await throwApiError(response);

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
};

interface ApiFetchBinaryInit extends Omit<RequestInit, 'body'> {
	body?: Uint8Array;
}

export const apiFetchBinary = async (
	path: string,
	{ body, ...init }: ApiFetchBinaryInit = {},
): Promise<Uint8Array> => {
	const response = await fetch(`${API_URL}${path}`, {
		...init,
		body: body as Uint8Array<ArrayBuffer> | undefined,
		credentials: 'include',
		headers: { 'Content-Type': 'application/octet-stream', ...init.headers },
	});

	if (!response.ok) await throwApiError(response);

	return new Uint8Array(await response.arrayBuffer());
};
