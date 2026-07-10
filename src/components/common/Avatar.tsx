import { useState } from 'react'

export const AVATAR_STYLES = [
  { id: 'adventurer', label: 'Adventurer' },
  { id: 'adventurer-neutral', label: 'Neutral' },
  { id: 'fun-emoji', label: 'Emoji' },
  { id: 'bottts', label: 'Robots' },
  { id: 'thumbs', label: 'Thumbs' },
  { id: 'pixel-art', label: 'Pixel' },
  { id: 'lorelei', label: 'Lorelei' },
  { id: 'notionists', label: 'Notionists' },
  { id: 'open-peeps', label: 'Peeps' },
  { id: 'croodles', label: 'Croodles' },
  { id: 'big-smile', label: 'Big Smile' },
  { id: 'miniavs', label: 'Mini' },
] as const

export type AvatarStyle = typeof AVATAR_STYLES[number]['id']

interface AvatarProps {
  name: string
  style?: string
  seed?: number
  size?: number
  className?: string
}

/**
 * Generates a consistent avatar using DiceBear API.
 * Seed = name + number for variation within same style.
 */
export function Avatar({ name, style = 'adventurer', seed = 0, size = 32, className = '' }: AvatarProps) {
  const avatarSeed = encodeURIComponent(`${name.toLowerCase().trim()}-${seed}`)
  const url = `https://api.dicebear.com/9.x/${style}/svg?seed=${avatarSeed}&size=${size}`

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

/**
 * Avatar picker - previews locally, only saves on "Save" button.
 * Shuffle changes seed locally (no network call until save).
 */
interface AvatarPickerProps {
  name: string
  selected: string
  seed: number
  onSelect: (style: string, seed: number) => void
}

export function AvatarPicker({ name, selected, seed, onSelect }: AvatarPickerProps) {
  const [localStyle, setLocalStyle] = useState(selected)
  const [localSeed, setLocalSeed] = useState(seed)
  const hasChanges = localStyle !== selected || localSeed !== seed

  return (
    <div className="space-y-3">
      {/* Current preview + shuffle */}
      <div className="flex items-center justify-center gap-3">
        <Avatar name={name} style={localStyle} seed={localSeed} size={64} />
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => setLocalSeed(Math.floor(Math.random() * 1000))}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            🎲 Shuffle
          </button>
          {hasChanges && (
            <button
              onClick={() => onSelect(localStyle, localSeed)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
            >
              ✓ Save
            </button>
          )}
        </div>
      </div>

      {/* Style grid */}
      <div className="grid grid-cols-4 gap-2">
        {AVATAR_STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setLocalStyle(s.id)}
            className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all ${
              localStyle === s.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
            }`}
          >
            <Avatar name={name} style={s.id} seed={localSeed} size={28} />
            <span className="text-[8px] text-slate-500 truncate w-full text-center">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
