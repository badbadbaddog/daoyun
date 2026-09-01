interface MutationResultProps {
  title: string
  message: string
  auditId?: string | null
  replayed?: boolean
}

export function MutationResult({ title, message, auditId, replayed }: MutationResultProps) {
  return <section className="mutation-result" role="status"><strong>{title}</strong><p>{message}</p>{auditId && <code>审计编号：{auditId}</code>}{replayed && <small>该结果来自幂等重放</small>}</section>
}
