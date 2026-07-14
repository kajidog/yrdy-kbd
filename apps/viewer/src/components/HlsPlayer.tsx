import Hls from 'hls.js'
import { browserLogger } from '@yrdy-kbd/web-shared'
import {
  Clock,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  PictureInPicture2,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type HlsPlayerProps = {
  src: string
  liveId: string
  title: string
  // Wall-clock time at position 0 of the media, used for the clock display
  // and seekbar tooltips.
  startedAt?: string
  live?: boolean
  onError?: (message: string) => void
}

type BufferedRange = {
  start: number
  end: number
}

const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2]

export function HlsPlayer({ src, liveId, title, startedAt, live = false, onError }: HlsPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const seekBarRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number>(0)
  const wasPlayingRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState<BufferedRange[]>([])
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [rateMenuOpen, setRateMenuOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)
  const [clockMode, setClockMode] = useState(false)

  const startEpoch = useMemo(() => {
    if (!startedAt) {
      return null
    }
    const parsed = new Date(startedAt).getTime()
    return Number.isNaN(parsed) ? null : parsed
  }, [startedAt])

  // --- media setup -------------------------------------------------------

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    let hls: Hls | null = null
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true })
      browserLogger.info('HLS player loading source', {
        event_name: 'hls_source_loading',
        live_id: liveId,
        playback_type: live ? 'live' : 'recording',
      })
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        browserLogger.info('HLS manifest loaded', {
          event_name: 'hls_manifest_loaded',
          live_id: liveId,
          playback_type: live ? 'live' : 'recording',
          level_count: data.levels.length,
        })
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        const context = {
          event_name: 'hls_playback_error',
          live_id: liveId,
          playback_type: live ? 'live' : 'recording',
          fatal: data.fatal,
          error_type: data.type,
          error_details: data.details,
        }
        if (data.fatal) {
          browserLogger.error('HLS playback failed', context)
          onError?.(`HLS playback error: ${data.details}`)
          hls?.destroy()
        } else {
          browserLogger.warn('HLS playback warning', context)
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      browserLogger.info('Native HLS player loading source', {
        event_name: 'hls_source_loading',
        live_id: liveId,
        playback_type: live ? 'live' : 'recording',
      })
      video.src = src
    } else {
      browserLogger.error('HLS playback is unsupported', {
        event_name: 'hls_playback_unsupported',
        live_id: liveId,
      })
      onError?.('This browser cannot play HLS streams')
    }

    return () => {
      hls?.destroy()
    }
  }, [src, liveId, live, onError])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    function readBuffered() {
      if (!video) {
        return
      }
      const ranges: BufferedRange[] = []
      for (let i = 0; i < video.buffered.length; i += 1) {
        ranges.push({ start: video.buffered.start(i), end: video.buffered.end(i) })
      }
      setBuffered(ranges)
    }

    function readDuration() {
      if (!video) {
        return
      }
      if (Number.isFinite(video.duration)) {
        setDuration(video.duration)
      } else if (video.seekable.length > 0) {
        setDuration(video.seekable.end(video.seekable.length - 1))
      }
    }

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      readDuration()
    }
    const onPlay = () => {
      setPlaying(true)
      browserLogger.info('Media playback started', {
        event_name: 'media_playback_started',
        live_id: liveId,
        playback_type: live ? 'live' : 'recording',
      })
    }
    const onPause = () => setPlaying(false)
    const onVolume = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }
    const onRate = () => setRate(video.playbackRate)

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', readDuration)
    video.addEventListener('loadedmetadata', readDuration)
    video.addEventListener('progress', readBuffered)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('volumechange', onVolume)
    video.addEventListener('ratechange', onRate)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', readDuration)
      video.removeEventListener('loadedmetadata', readDuration)
      video.removeEventListener('progress', readBuffered)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('volumechange', onVolume)
      video.removeEventListener('ratechange', onRate)
    }
  }, [liveId, live])

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // --- controls visibility ------------------------------------------------

  const pokeControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
      setRateMenuOpen(false)
    }, 2800)
  }, [])

  useEffect(() => {
    return () => window.clearTimeout(hideTimerRef.current)
  }, [])

  const showControls = !playing || controlsVisible || dragging || rateMenuOpen

  // --- actions ------------------------------------------------------------

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) {
      return
    }
    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }, [])

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current
      if (!video || duration <= 0) {
        return
      }
      const clamped = Math.min(Math.max(time, 0), Math.max(duration - 0.1, 0))
      video.currentTime = clamped
      setCurrentTime(clamped)
    },
    [duration],
  )

  const skip = useCallback(
    (delta: number) => {
      const video = videoRef.current
      if (video) {
        seekTo(video.currentTime + delta)
      }
    },
    [seekTo],
  )

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (video) {
      video.muted = !video.muted
    }
  }, [])

  const changeVolume = useCallback((value: number) => {
    const video = videoRef.current
    if (video) {
      video.volume = Math.min(Math.max(value, 0), 1)
      video.muted = video.volume === 0
    }
  }, [])

  const changeRate = useCallback((value: number) => {
    const video = videoRef.current
    if (video) {
      video.playbackRate = value
    }
    setRateMenuOpen(false)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void containerRef.current?.requestFullscreen()
    }
  }, [])

  const togglePiP = useCallback(() => {
    const video = videoRef.current
    if (!video || !document.pictureInPictureEnabled) {
      return
    }
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture()
    } else {
      void video.requestPictureInPicture()
    }
  }, [])

  // --- seek bar pointer handling -------------------------------------------

  const timeFromPointer = useCallback(
    (clientX: number) => {
      const bar = seekBarRef.current
      if (!bar || duration <= 0) {
        return 0
      }
      const rect = bar.getBoundingClientRect()
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
      return ratio * duration
    },
    [duration],
  )

  function handleSeekPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const video = videoRef.current
    if (!video || duration <= 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    wasPlayingRef.current = !video.paused
    video.pause()
    seekTo(timeFromPointer(event.clientX))
  }

  function handleSeekPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const bar = seekBarRef.current
    if (bar) {
      const rect = bar.getBoundingClientRect()
      const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
      setHover({ x, time: timeFromPointer(event.clientX) })
    }
    if (dragging) {
      seekTo(timeFromPointer(event.clientX))
    }
    pokeControls()
  }

  function handleSeekPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) {
      return
    }
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    seekTo(timeFromPointer(event.clientX))
    if (wasPlayingRef.current) {
      void videoRef.current?.play()
    }
  }

  // --- keyboard shortcuts --------------------------------------------------

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const key = event.key
    if (key === ' ' || key === 'k') {
      togglePlay()
    } else if (key === 'ArrowLeft') {
      skip(-10)
    } else if (key === 'ArrowRight') {
      skip(10)
    } else if (key === 'j') {
      skip(-30)
    } else if (key === 'l') {
      skip(30)
    } else if (key === 'ArrowUp') {
      changeVolume((videoRef.current?.volume ?? 0) + 0.1)
    } else if (key === 'ArrowDown') {
      changeVolume((videoRef.current?.volume ?? 0) - 0.1)
    } else if (key === 'm') {
      toggleMute()
    } else if (key === 'f') {
      toggleFullscreen()
    } else if (/^[0-9]$/.test(key)) {
      seekTo((duration * Number(key)) / 10)
    } else if (key === 'Home') {
      seekTo(0)
    } else if (key === 'End') {
      seekTo(duration)
    } else {
      return
    }
    event.preventDefault()
    pokeControls()
  }

  // --- derived rendering data ----------------------------------------------

  const progressRatio = duration > 0 ? currentTime / duration : 0
  const ticks = useMemo(() => buildTicks(duration), [duration])
  const showHours = duration >= 3600

  function wallClock(mediaTime: number): string | null {
    if (startEpoch == null) {
      return null
    }
    return new Date(startEpoch + mediaTime * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const timeLabel = clockMode && startEpoch != null
    ? `${wallClock(currentTime)} · started ${new Date(startEpoch).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })}`
    : `${formatTime(currentTime, showHours)} / ${formatTime(duration, showHours)}`

  return (
    <div
      ref={containerRef}
      className={`player ${showControls ? 'controls-visible' : 'controls-hidden'}`}
      onMouseMove={pokeControls}
      onMouseLeave={() => setHover(null)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label={`Player: ${title}`}
    >
      <video ref={videoRef} playsInline onClick={togglePlay} onDoubleClick={toggleFullscreen} />

      {!playing && (
        <button type="button" className="big-play" onClick={togglePlay} aria-label="Play">
          <Play size={34} aria-hidden="true" />
        </button>
      )}

      {live && (
        <div className="player-live-chip">
          <span aria-hidden="true" />
          LIVE
        </div>
      )}

      <div className="player-shade" aria-hidden="true" />

      <div className="player-controls">
        <div className="seek-area">
          {hover && duration > 0 && (
            <div className="seek-tooltip" style={{ left: hover.x }}>
              <strong>{formatTime(hover.time, showHours)}</strong>
              {wallClock(hover.time) && <span>{wallClock(hover.time)}</span>}
            </div>
          )}
          <div
            ref={seekBarRef}
            className="seek-bar"
            onPointerDown={handleSeekPointerDown}
            onPointerMove={handleSeekPointerMove}
            onPointerUp={handleSeekPointerUp}
            onPointerLeave={() => setHover(null)}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={formatTime(currentTime, showHours)}
          >
            <div className="seek-track">
              {buffered.map((range) =>
                duration > 0 ? (
                  <div
                    key={`${range.start}-${range.end}`}
                    className="seek-buffered"
                    style={{
                      left: `${(range.start / duration) * 100}%`,
                      width: `${((range.end - range.start) / duration) * 100}%`,
                    }}
                  />
                ) : null,
              )}
              <div className="seek-progress" style={{ width: `${progressRatio * 100}%` }} />
            </div>
            <div className="seek-knob" style={{ left: `${progressRatio * 100}%` }} />
          </div>

          <div className="seek-ruler" aria-hidden="true">
            {ticks.map((tick) =>
              duration > 0 ? (
                <div
                  key={tick.time}
                  className={`ruler-tick ${tick.major ? 'major' : ''}`}
                  style={{ left: `${(tick.time / duration) * 100}%` }}
                >
                  {tick.major && <span>{formatTime(tick.time, showHours)}</span>}
                </div>
              ) : null,
            )}
          </div>
        </div>

        <div className="control-row">
          <button type="button" className="ctl" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
          </button>
          <button type="button" className="ctl" onClick={() => skip(-10)} aria-label="Back 10 seconds">
            <RotateCcw size={18} aria-hidden="true" />
            <em>10</em>
          </button>
          <button type="button" className="ctl" onClick={() => skip(10)} aria-label="Forward 10 seconds">
            <RotateCw size={18} aria-hidden="true" />
            <em>10</em>
          </button>

          <button type="button" className="ctl" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || volume === 0 ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
          </button>
          <input
            className="volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            aria-label="Volume"
          />

          <button
            type="button"
            className="ctl time-label"
            onClick={() => setClockMode((mode) => !mode)}
            title={startEpoch != null ? 'Toggle wall-clock time' : undefined}
            disabled={startEpoch == null}
          >
            {clockMode && startEpoch != null && <Clock size={15} aria-hidden="true" />}
            {timeLabel}
          </button>

          <span className="control-spacer" />

          <div className="rate-menu-wrap">
            <button
              type="button"
              className="ctl"
              onClick={() => setRateMenuOpen((open) => !open)}
              aria-label="Playback speed"
            >
              <Gauge size={18} aria-hidden="true" />
              <em>{rate}x</em>
            </button>
            {rateMenuOpen && (
              <div className="rate-menu" role="menu">
                {playbackRates.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={value === rate}
                    className={value === rate ? 'active' : ''}
                    onClick={() => changeRate(value)}
                  >
                    {value}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {document.pictureInPictureEnabled && (
            <button type="button" className="ctl" onClick={togglePiP} aria-label="Picture in picture">
              <PictureInPicture2 size={18} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="ctl" onClick={toggleFullscreen} aria-label="Fullscreen">
            {fullscreen ? <Minimize size={18} aria-hidden="true" /> : <Maximize size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}

type Tick = {
  time: number
  major: boolean
}

// buildTicks lays a time ruler under the seek bar: major (labelled) ticks on a
// "nice" interval chosen from the duration, with minor ticks in between.
function buildTicks(duration: number): Tick[] {
  if (!Number.isFinite(duration) || duration <= 0) {
    return []
  }

  const majorSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400]
  const major = majorSteps.find((step) => duration / step <= 8) ?? 21600
  const minor = major / 4

  const ticks: Tick[] = []
  for (let time = 0; time <= duration; time += minor) {
    const isMajor = Math.round(time / minor) % 4 === 0
    // Skip a major label that would collide with the right edge.
    if (isMajor && duration - time < major * 0.35 && time !== 0) {
      continue
    }
    ticks.push({ time, major: isMajor })
  }
  return ticks
}

function formatTime(totalSeconds: number, forceHours: boolean): string {
  if (!Number.isFinite(totalSeconds)) {
    return '--:--'
  }
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0 || forceHours) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
