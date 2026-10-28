const API_URL = 'http://localhost:3333/api';

export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
	const response = await fetch(`${API_URL}${path}`, {
		...init,
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...init?.headers },
	});

	if (!response.ok) {
		const body: { error?: string } | null = await response.json().catch(() => null);
		throw new ApiError(response.status, body?.error ?? response.statusText);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
};
