import { useState, type FormEvent } from 'react'
import {
  ArrowRight,
  CheckmarkFilled,
  ConnectionSignal,
  Locked,
  User,
  View,
  ViewOff,
  WarningAltFilled,
} from '@carbon/icons-react'
import greenhouseImage from '../assets/hydroponic-greenhouse.webp'

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<boolean>
  backendAvailable: boolean
}

export function LoginPage({ onLogin, backendAvailable }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [heroVideoFailed, setHeroVideoFailed] = useState(false)

  const heroVideoUrl = (import.meta.env.VITE_HERO_VIDEO_URL as string | undefined)?.trim() || '/media/green_house.mp4'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim() || !password.trim()) {
      setError('Harap masukkan username dan kata sandi Anda.')
      return
    }

    setLoading(true)
    try {
      await onLogin(username.trim(), password)
    } catch (err: any) {
      setError(err.message || 'Login gagal. Periksa username dan password Anda.')
      setLoading(false)
    }
  }

  return (
    <div className="login-page-shell">
      {/* Top Floating Navigation Bar (Identical to Dashboard Topbar) */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <img src="/brand/hydra-logo-mark.png" alt="Hydra" />
            </span>
            <span><strong>HYDRA</strong><small>IoT MONITORING</small></span>
          </div>

          <div className="topbar-login-status">
            <span className={`device-status ${backendAvailable ? 'online' : ''}`}>
              <i />
              {backendAvailable ? 'Server terhubung' : 'Memeriksa backend'}
            </span>
            <span className="stream-status live">
              <ConnectionSignal size={18} />
              LIVE GATEWAY
            </span>
          </div>
        </div>
      </header>

      {/* Hero-Style Login Section */}
      <main className="hero login-hero">
        <div className="hero-copy login-hero-copy">
          <p className="overline"><span />Hydroponics control center</p>
          <h1 className="hero-title">
            <span className="line">
              <span>Masuk <i className="inline-crop" style={{ backgroundImage: `url(${greenhouseImage})` }} aria-hidden="true" /> sistem</span>
            </span>
            <span className="line">
              <em>hidroponik.</em>
            </span>
          </h1>
          <p className="hero-lead">
            Autentikasi staf laboratorium untuk akses monitoring larutan nutrisi, telemetri greenhouse, dan kendali aktuator.
          </p>

          {/* Clean Integrated Login Form */}
          <div className="login-form-wrapper">
            {error && (
              <div className="login-clean-error" role="alert">
                <WarningAltFilled size={18} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-clean-form">
              <div className="login-clean-fields">
                <div className="clean-input-group">
                  <label htmlFor="login-username">Username</label>
                  <div className="clean-input-box">
                    <User size={18} className="clean-icon" />
                    <input
                      id="login-username"
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="Username admin"
                      autoComplete="username"
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="clean-input-group">
                  <label htmlFor="login-password">Kata Sandi</label>
                  <div className="clean-input-box">
                    <Locked size={18} className="clean-icon" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Kata sandi"
                      autoComplete="current-password"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="clean-eye-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      title={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                    >
                      {showPassword ? <ViewOff size={18} /> : <View size={18} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="login-clean-options">
                <label className="clean-checkbox">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  <span>Ingat sesi di browser ini</span>
                </label>
                <span className="clean-secure-note">
                  <CheckmarkFilled size={14} /> Terenkripsi HMAC
                </span>
              </div>

              <button
                type="submit"
                className="hero-action login-action-btn"
                disabled={loading}
              >
                {loading ? (
                  <span>Memverifikasi kredensial...</span>
                ) : (
                  <>
                    <span>Masuk ke dashboard</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Video Visual on Right Side (Exact Match to Dashboard Hero Visual) */}
        <div className="hero-visual" aria-hidden="true">
          {!heroVideoFailed ? (
            <video
              autoPlay
              loop
              muted
              playsInline
              poster={greenhouseImage}
              onError={() => setHeroVideoFailed(true)}
            >
              <source src={heroVideoUrl} type="video/mp4" />
            </video>
          ) : (
            <img src={greenhouseImage} alt="" />
          )}
          <span className="visual-caption">Live cultivation system</span>
        </div>
      </main>
    </div>
  )
}
