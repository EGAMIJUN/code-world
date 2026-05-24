import { z } from "zod"

export const UserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().regex(/^[a-zA-Z0-9_]{4,16}$/),
  totalKills: z.number().int().nonnegative(),
  totalDeaths: z.number().int().nonnegative(),
  totalScore: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
})

export const SignupSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{4,16}$/),
  password: z.string().min(8).max(128),
})

export const LoginSchema = SignupSchema

export type User = z.infer<typeof UserSchema>
export type Signup = z.infer<typeof SignupSchema>
export type Login = z.infer<typeof LoginSchema>
