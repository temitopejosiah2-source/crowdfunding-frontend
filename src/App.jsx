import { useCallback, useEffect, useState } from 'react'
import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers'
import './App.css'

const CONTRACT_ADDRESS = '0x0B14BDDb6890202147D35C80C4C285165643D642'
const CAMPAIGN_ABI = [
  'function NextCampignId() view returns (uint256)',
  'function campaign(uint256) view returns (address creator,uint256 target,uint256 deadline,uint256 moneyRaised,uint256 moneyavailable,bool active,bool cancelled,address tokenAccepted)',
  'function contributors(uint256,address) view returns (uint256 amount)',
  'function createCampaign(uint256 target,uint256 deadline,address tokenAccepted,uint256[] amounts,uint8[] statuses) returns (uint256 campaignId)',
  'function contributing(uint256 amount,address token,uint256 campaignId)',
  'function approveMilestones(uint256 campaignId) returns (bool success)',
  'function Withdrawal(uint256 campaignId)',
  'function refundMoney(uint256 campaignId)',
  'function cancelCampaign(uint256 campaignId)',
]
const TOKEN_ABI = [
  'function approve(address spender,uint256 amount) returns (bool)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]
const STATUS_NAMES = ['Early', 'Medium', 'Late']

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function App() {
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [account, setAccount] = useState('')
  const [chainId, setChainId] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [tokenInfo, setTokenInfo] = useState({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [amount, setAmount] = useState('')
  const [createForm, setCreateForm] = useState({ target: '', deadline: '', token: '', milestones: [{ amount: '', status: '0' }] })

  const writeContract = signer ? new Contract(CONTRACT_ADDRESS, CAMPAIGN_ABI, signer) : null

  async function connectWallet() {
    setError('')
    if (!window.ethereum) {
      setError('No injected wallet found. Install or enable MetaMask, then reload.')
      return
    }
    try {
      const nextProvider = new BrowserProvider(window.ethereum)
      await nextProvider.send('eth_requestAccounts', [])
      const nextSigner = await nextProvider.getSigner()
      const network = await nextProvider.getNetwork()
      setProvider(nextProvider)
      setSigner(nextSigner)
      setAccount(await nextSigner.getAddress())
      setChainId(network.chainId)
    } catch (caughtError) {
      setError(caughtError.shortMessage || caughtError.message || 'Wallet connection failed.')
    }
  }

  const loadCampaigns = useCallback(async () => {
    if (!provider) return
    setLoading(true)
    setError('')
    try {
      const contract = new Contract(CONTRACT_ADDRESS, CAMPAIGN_ABI, provider)
      const count = Number(await contract.NextCampignId())
      const records = await Promise.all(Array.from({ length: count }, async (_, id) => {
        const [data, contribution] = await Promise.all([
          contract.campaign(id),
          account ? contract.contributors(id, account) : Promise.resolve({ amount: 0n }),
        ])
        return {
          id,
          creator: data.creator,
          target: data.target,
          deadline: data.deadline,
          moneyRaised: data.moneyRaised,
          moneyavailable: data.moneyavailable,
          active: data.active,
          cancelled: data.cancelled,
          tokenAccepted: data.tokenAccepted,
          contribution: contribution.amount,
        }
      }))
      setCampaigns(records.reverse())
      setSelectedCampaign((current) => current || (records.length ? String(records.at(-1).id) : ''))

      const uniqueTokens = [...new Set(records.map((item) => item.tokenAccepted.toLowerCase()))]
      const metadata = {}
      await Promise.all(uniqueTokens.map(async (address) => {
        try {
          const token = new Contract(address, TOKEN_ABI, provider)
          const [decimals, symbol, balance] = await Promise.all([
            token.decimals(), token.symbol(), account ? token.balanceOf(account) : Promise.resolve(0n),
          ])
          metadata[address] = { decimals: Number(decimals), symbol, balance }
        } catch {
          metadata[address] = { decimals: 18, symbol: 'TOKEN', balance: 0n }
        }
      }))
      setTokenInfo(metadata)
    } catch (caughtError) {
      setError(caughtError.shortMessage || caughtError.message || 'Could not load contract data. Check the selected network.')
    } finally {
      setLoading(false)
    }
  }, [provider, account])

  useEffect(() => {
    if (provider) queueMicrotask(loadCampaigns)
  }, [provider, loadCampaigns])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!window.ethereum) return undefined
    const handleAccountsChanged = () => window.location.reload()
    const handleChainChanged = () => window.location.reload()
    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged', handleChainChanged)
    }
  }, [])

  async function sendTransaction(label, transaction) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const tx = await transaction()
      setNotice(`${label} submitted. Waiting for confirmation...`)
      await tx.wait()
      setNotice(`${label} confirmed.`)
      await loadCampaigns()
    } catch (caughtError) {
      setError(caughtError.shortMessage || caughtError.reason || caughtError.message || `${label} failed.`)
    } finally {
      setBusy(false)
    }
  }

  async function createCampaign(event) {
    event.preventDefault()
    const targetToken = new Contract(createForm.token, TOKEN_ABI, provider)
    try {
      const decimals = Number(await targetToken.decimals())
      const target = parseUnits(createForm.target, decimals)
      const milestoneAmounts = createForm.milestones.map((item) => parseUnits(item.amount, decimals))
      const deadline = BigInt(Math.floor(new Date(createForm.deadline).getTime() / 1000))
      await sendTransaction('Campaign creation', () => writeContract.createCampaign(
        target, deadline, createForm.token, milestoneAmounts,
        createForm.milestones.map((item) => Number(item.status)),
      ))
    } catch (caughtError) {
      setError(caughtError.shortMessage || caughtError.message || 'Enter valid token amounts and deadline.')
    }
  }

  async function contribute(event) {
    event.preventDefault()
    const selected = campaigns.find((item) => String(item.id) === selectedCampaign)
    if (!selected) return
    try {
      const token = new Contract(selected.tokenAccepted, TOKEN_ABI, signer)
      const decimals = tokenInfo[selected.tokenAccepted.toLowerCase()]?.decimals ?? Number(await token.decimals())
      const value = parseUnits(amount, decimals)
      const allowance = await token.allowance(account, CONTRACT_ADDRESS)
      if (allowance < value) {
        const approval = await token.approve(CONTRACT_ADDRESS, value)
        setNotice('Token approval submitted. Waiting for confirmation...')
        await approval.wait()
        setNotice('Token approved. Submitting contribution...')
      }
      await sendTransaction('Contribution', () => writeContract.contributing(value, selected.tokenAccepted, selected.id))
      setAmount('')
    } catch (caughtError) {
      setError(caughtError.shortMessage || caughtError.reason || caughtError.message || 'Contribution failed.')
    }
  }

  const selected = campaigns.find((item) => String(item.id) === selectedCampaign)
  const selectedToken = selected ? tokenInfo[selected.tokenAccepted.toLowerCase()] : null
  const unit = selectedToken?.symbol || 'TOKEN'
  const decimals = selectedToken?.decimals ?? 18
  const selectedIsCreator = selected && account && selected.creator.toLowerCase() === account.toLowerCase()
  const campaignStatus = (item) => item.cancelled ? 'Cancelled' : !item.active ? 'Inactive' : now >= Number(item.deadline) ? 'Ended' : 'Active'

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home"><span className="brand-mark">F</span><span>Fieldwork<span className="brand-dot">.</span></span></a>
        <div className="topbar-actions">
          {account && <span className="network-label">{chainId ? `Chain ${chainId}` : 'Wallet connected'}</span>}
          <button className="wallet-button" onClick={connectWallet}>{account ? shortAddress(account) : 'Connect wallet'}</button>
        </div>
      </header>

      <section className="intro" id="home">
        <div>
          <p className="eyebrow">COMMUNITY CAPITAL / ON-CHAIN</p>
          <h1>Back work<br /><span>worth doing.</span></h1>
          <p className="intro-copy">Explore campaigns, follow their progress, and put capital behind the milestones that matter.</p>
        </div>
        <div className="contract-chip"><span className="status-pulse" />Contract 02 <span className="chip-divider" />{shortAddress(CONTRACT_ADDRESS)}</div>
      </section>

      <div className="workspace">
        <section className="campaign-section">
          <div className="section-heading">
            <div><p className="eyebrow">THE OPEN CALL</p><h2>Campaigns <span className="count">{campaigns.length}</span></h2></div>
            <button className="refresh-button" onClick={loadCampaigns} disabled={!provider || loading} title="Refresh campaigns" aria-label="Refresh campaigns">↻</button>
          </div>
          {!provider ? (
            <div className="empty-state"><span className="empty-index">01</span><h3>Connect to the network</h3><p>Connect an injected wallet to read campaigns and use the contract.</p><button className="text-button" onClick={connectWallet}>Connect wallet <span>↗</span></button></div>
          ) : loading && campaigns.length === 0 ? (
            <div className="empty-state"><span className="loading-mark">◌</span><h3>Reading the ledger</h3><p>Fetching campaigns from the connected network.</p></div>
          ) : campaigns.length === 0 ? (
            <div className="empty-state"><span className="empty-index">00</span><h3>The first chapter is unwritten</h3><p>Create a campaign to open this funding round.</p></div>
          ) : (
            <div className="campaign-list">
              {campaigns.map((item, index) => {
                const token = tokenInfo[item.tokenAccepted.toLowerCase()]
                const itemDecimals = token?.decimals ?? 18
                const progress = item.target > 0n ? Math.min(100, Number((item.moneyRaised * 100n) / item.target)) : 0
                return (
                  <button className={`campaign-row ${String(item.id) === selectedCampaign ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelectedCampaign(String(item.id))}>
                    <span className="row-number">{String(campaigns.length - index).padStart(2, '0')}</span>
                    <span className="campaign-main"><span className="campaign-title">Campaign {item.id}</span><span className="campaign-meta">by {shortAddress(item.creator)} <span>·</span> {shortAddress(item.tokenAccepted)}</span><span className="progress-track"><span style={{ width: `${progress}%` }} /></span></span>
                    <span className="campaign-figures"><strong>{formatUnits(item.moneyRaised, itemDecimals)} <small>{token?.symbol || ''}</small></strong><span>of {formatUnits(item.target, itemDecimals)} target</span></span>
                    <span className={`state-label state-${campaignStatus(item).toLowerCase()}`}><i />{campaignStatus(item)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {selected && (
            <article className="detail-panel">
              <div className="detail-top"><div><p className="eyebrow">CAMPAIGN / {String(selected.id).padStart(4, '0')}</p><h3>Campaign {selected.id}</h3></div><span className={`state-label state-${campaignStatus(selected).toLowerCase()}`}><i />{campaignStatus(selected)}</span></div>
              <div className="stats-grid">
                <div><span>Raised</span><strong>{formatUnits(selected.moneyRaised, decimals)} <small>{unit}</small></strong></div>
                <div><span>Target</span><strong>{formatUnits(selected.target, decimals)} <small>{unit}</small></strong></div>
                <div><span>Available</span><strong>{formatUnits(selected.moneyavailable, decimals)} <small>{unit}</small></strong></div>
                <div><span>Deadline</span><strong>{new Date(Number(selected.deadline) * 1000).toLocaleDateString()}</strong></div>
                <div><span>Your contribution</span><strong>{formatUnits(selected.contribution, decimals)} <small>{unit}</small></strong></div>
                <div><span>Accepted token</span><strong className="address-value">{shortAddress(selected.tokenAccepted)}</strong></div>
              </div>
              <div className="milestone-note"><span>i</span><p>Milestones are stored on-chain, but this contract has no public milestone getter, so their amounts and approval states cannot be read by this interface.</p></div>
              {account && <div className="balance-line">Wallet balance <strong>{selectedToken ? `${formatUnits(selectedToken.balance, decimals)} ${unit}` : 'Unavailable'}</strong></div>}
              {selected.active && !selected.cancelled && now < Number(selected.deadline) && (
                <form className="contribute-form" onSubmit={contribute}>
                  <label className="field grow"><span>Support this campaign</span><div className="input-suffix"><input required min="0" step="any" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /><span>{unit}</span></div></label>
                  <button className="primary-button" disabled={!account || busy}>Contribute <span>↗</span></button>
                </form>
              )}
              <div className="action-row">
                <button className="secondary-button" disabled={!account || busy || !selected.active || now < Number(selected.deadline)} onClick={() => sendTransaction('Milestone approvals', () => writeContract.approveMilestones(selected.id))}>Approve milestones</button>
                {selectedIsCreator && <button className="secondary-button" disabled={busy || !selected.active} onClick={() => sendTransaction('Withdrawal', () => writeContract.Withdrawal(selected.id))}>Withdraw next milestone</button>}
                {selected.contribution > 0n && <button className="secondary-button" disabled={busy} onClick={() => sendTransaction('Refund', () => writeContract.refundMoney(selected.id))}>Request refund</button>}
                {selectedIsCreator && <button className="danger-button" disabled={busy || !selected.active} onClick={() => sendTransaction('Campaign cancellation', () => writeContract.cancelCampaign(selected.id))}>Cancel campaign</button>}
              </div>
            </article>
          )}
        </section>

        <aside className="create-section">
          <div className="section-heading"><div><p className="eyebrow">START SOMETHING</p><h2>Open a campaign</h2></div><span className="section-index">02</span></div>
          <form className="create-form" onSubmit={createCampaign}>
            <label className="field"><span>Funding target</span><input required min="0" step="any" type="number" placeholder="e.g. 2500" value={createForm.target} onChange={(event) => setCreateForm({ ...createForm, target: event.target.value })} /></label>
            <label className="field"><span>Accepted ERC-20 token</span><input required placeholder="0x token address" value={createForm.token} onChange={(event) => setCreateForm({ ...createForm, token: event.target.value })} /></label>
            <label className="field"><span>Funding deadline</span><input required type="datetime-local" value={createForm.deadline} onChange={(event) => setCreateForm({ ...createForm, deadline: event.target.value })} /></label>
            <div className="milestone-builder"><div className="milestone-heading"><span>Release milestones</span><span>{String(createForm.milestones.length).padStart(2, '0')}</span></div>
              {createForm.milestones.map((milestone, index) => <div className="milestone-fields" key={index}><span className="milestone-number">{String(index + 1).padStart(2, '0')}</span><input required min="0" step="any" type="number" placeholder="Amount" value={milestone.amount} onChange={(event) => setCreateForm({ ...createForm, milestones: createForm.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item) })} /><select aria-label={`Milestone ${index + 1} status`} value={milestone.status} onChange={(event) => setCreateForm({ ...createForm, milestones: createForm.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value } : item) })}>{STATUS_NAMES.map((name, statusIndex) => <option key={name} value={statusIndex}>{name}</option>)}</select>{createForm.milestones.length > 1 && <button type="button" className="remove-milestone" aria-label={`Remove milestone ${index + 1}`} onClick={() => setCreateForm({ ...createForm, milestones: createForm.milestones.filter((_, itemIndex) => itemIndex !== index) })}>×</button>}</div>)}
              <button type="button" className="add-milestone" onClick={() => setCreateForm({ ...createForm, milestones: [...createForm.milestones, { amount: '', status: '0' }] })}><span>＋</span> Add milestone</button>
            </div>
            <button className="primary-button create-button" disabled={!account || busy}>Create campaign <span>↗</span></button>
            {!account && <p className="form-hint">Connect a wallet to create a campaign.</p>}
          </form>
        </aside>
      </div>

      {(notice || error) && <div className={`toast ${error ? 'toast-error' : ''}`} role="status"><span>{error ? '!' : '↗'}</span><p>{error || notice}</p><button onClick={() => { setError(''); setNotice('') }} aria-label="Dismiss message">×</button></div>}
      <footer className="footer"><span>FIELDWORK / FUNDING WITH INTENTION</span><span>CONTRACT 02 · {shortAddress(CONTRACT_ADDRESS)}</span></footer>
    </main>
  )
}

export default App