import { useState } from 'react'
import { addDoc, collection, doc, setDoc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'

export default function FixUser() {
  const { user } = useAuth()
  const [status, setStatus] = useState('Choose an action below.')

  const createFleetManager = async () => {
    setStatus('Creating...')
    try {
      await setDoc(doc(db, 'users', 'nxagnZno6ihyTIENDrdv8Wk6wR23'), {
        email: 'fleet.mgr@test.com',
        name: 'Fleet Manager',
        role: 'general_manager',
        branch: null,
        company_id: null,
        is_admin: true,
        is_active: 1,
        createdAt: Timestamp.now(),
      })
      setStatus('Done! Fleet Manager doc created. Sign in as fleet.mgr@test.com / test1234')
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const assignBranch = async () => {
    setStatus('Updating...')
    try {
      await updateDoc(doc(db, 'users', 'e5pOnZgCsbUMazvAgE6IuQeO7Ji2'), { branch: 'MGCAVITE' })
      setStatus('Done! Admin Supervisor branch set to MGCAVITE.')
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const createFinanceUser = async () => {
    setStatus('Step 1: Go to Admin > Users > Invite User. Enter email: finance@test.com, role: MG Fleet Finance, check "Send a temporary password", enter test1234, click Send invite. The invite flow will create both the Auth account and user doc.')
  }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 16 }}>Fix User</h1>
      <p style={{ marginBottom: 8 }}>{status}</p>
      <p style={{ marginBottom: 16, fontSize: 12, color: '#666' }}>
        Logged in as: {user?.email || 'NOT LOGGED IN — go to /login first'}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={createFleetManager}
          style={{ background: '#b91c1c', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Create Fleet Manager Doc
        </button>
        <button
          onClick={assignBranch}
          style={{ background: '#1d4ed8', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Assign Admin Supervisor to MGCAVITE
        </button>
        <button
          onClick={createFinanceUser}
          style={{ background: '#059669', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Create Fleet Finance Manager
        </button>
      </div>
    </div>
  )
}
