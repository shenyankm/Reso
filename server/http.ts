import { z } from 'zod'

export class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message) } }
export const uuid = z.string().uuid()
export const text = (max: number) => z.string().trim().min(1).max(max)
export const domainSchema = z.enum(['private','room']).default('private')
export const eventId = (request: { params: unknown }) => uuid.parse((request.params as { id: string }).id)
export const json = (value: unknown) => JSON.stringify(value)
