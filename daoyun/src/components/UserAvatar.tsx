import { useEffect, useState } from "react"

interface UserAvatarProps {
  username: string
  displayName: string
  avatarUrl: string | null
  size?: "small" | "medium" | "large"
}

export function UserAvatar({
  username,
  displayName,
  avatarUrl,
  size = "medium",
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [avatarUrl])

  const tone = [...username].reduce((total, character) => total + character.codePointAt(0)!, 0) % 4
  const className = `user-avatar user-avatar--${size} user-avatar--tone-${tone}`

  if (avatarUrl && !failed) {
    return (
      <img
        className={className}
        src={avatarUrl}
        alt={`${displayName}的头像`}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span className={className} aria-hidden="true">
      {username.charAt(0).toLocaleUpperCase("en-US") || "?"}
    </span>
  )
}
