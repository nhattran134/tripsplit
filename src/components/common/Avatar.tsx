interface AvatarProps {
  name: string
  size?: number
  className?: string
}

/**
 * Generates a consistent fun avatar using DiceBear API.
 * Same name always produces the same avatar.
 * Uses "adventurer" style (cute illustrated faces).
 */
export function Avatar({ name, size = 32, className = '' }: AvatarProps) {
  const seed = encodeURIComponent(name.toLowerCase().trim())
  const url = `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}&size=${size}`

  return (
    <img
      src={url}
      alt={name}
      width={size}
      height={size}
      className={`rounded-full bg-slate-100 dark:bg-slate-700 ${className}`}
      loading="lazy"
    />
  )
}
