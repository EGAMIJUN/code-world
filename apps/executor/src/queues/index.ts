import { Queue } from "bullmq"
import type IORedis from "ioredis"

export const QUEUE_NAMES = {
  CODE_EXECUTION: "code-execution",
  REWARD_GRANT: "reward-grant",
} as const

export function createQueues(connection: IORedis) {
  const codeExecution = new Queue(QUEUE_NAMES.CODE_EXECUTION, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  })

  const rewardGrant = new Queue(QUEUE_NAMES.REWARD_GRANT, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 500 },
    },
  })

  return { codeExecution, rewardGrant }
}

export type Queues = ReturnType<typeof createQueues>
