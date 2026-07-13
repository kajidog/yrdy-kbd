import { errorMessage } from '@yrdy-kbd/web-shared'
import { Disc, Globe, Plus } from 'lucide-react'
import { useState } from 'react'
import { createLive, type LiveSummary } from '../../graphql/operations'

type CreateLivePanelProps = {
  onCreated: (live: LiveSummary) => void | Promise<void>
  onError: (message: string) => void
}

export function CreateLivePanel({ onCreated, onError }: CreateLivePanelProps) {
  const [title, setTitle] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [record, setRecord] = useState(true)
  const [creating, setCreating] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    onError('')
    setCreating(true)
    try {
      const created = await createLive({
        title,
        passphrase: passphrase || undefined,
        public: isPublic,
        record,
      })
      setTitle('')
      setPassphrase('')
      await onCreated(created)
    } catch (caught) {
      onError(errorMessage(caught))
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="control-panel" aria-label="Create live">
      <h2>New live</h2>
      <form className="live-form" onSubmit={handleSubmit}>
        <label>
          <span>Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What are you streaming?"
            maxLength={120}
          />
        </label>
        <label>
          <span>Passphrase (optional)</span>
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="leave empty for open access"
            autoComplete="off"
          />
        </label>
        <div className="toggle-row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            <Globe size={16} aria-hidden="true" />
            <span>Public (listed in search)</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={record}
              onChange={(event) => setRecord(event.target.checked)}
            />
            <Disc size={16} aria-hidden="true" />
            <span>Record (watch later over HLS)</span>
          </label>
        </div>
        <button type="submit" disabled={creating || !title.trim()}>
          <Plus size={18} aria-hidden="true" />
          Create live
        </button>
      </form>
    </section>
  )
}
