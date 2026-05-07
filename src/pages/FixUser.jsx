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
    setStatus('Step 1: Go to Admin > Users > Invite User. Enter email: finance@test.com, role: MG Fleet Finance, check "Send a temporary password", enter test1234, click Send invite.')
  }

  const fixGmUser = async () => {
    setStatus('Updating gm@test.com...')
    try {
      // Find the user doc by checking all users — we'll update by UID
      const { getDocs, query, where } = await import('firebase/firestore')
      const snap = await getDocs(query(collection(db, 'users'), where('email', '==', 'gm@test.com')))
      if (snap.empty) {
        // Try to update the current user if they're logged in as gm@test.com
        if (user?.email === 'gm@test.com' && user?.uid) {
          await setDoc(doc(db, 'users', user.uid), {
            email: 'gm@test.com',
            name: 'GM Fleet Manager',
            role: 'general_manager',
            branch: null,
            company_id: null,
            is_admin: true,
            is_active: 1,
            createdAt: Timestamp.now(),
          })
          setStatus('Done! gm@test.com set to Fleet Manager. Refresh the page.')
        } else {
          setStatus('No user doc found for gm@test.com. Log in as gm@test.com first, then click this button.')
        }
        return
      }
      const userDoc = snap.docs[0]
      await updateDoc(doc(db, 'users', userDoc.id), {
        role: 'general_manager',
        is_admin: true,
      })
      setStatus('Done! gm@test.com updated to Fleet Manager role with admin access. Refresh the page.')
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const createTestVehicle = async () => {
    setStatus('Creating test vehicle...')
    try {
      await addDoc(collection(db, 'assessments'), {
        id: Date.now(),
        rwaNumber: `RWA-2026-${Date.now().toString().slice(-6)}`,
        header: {
          plate: 'TEST001',
          make: 'Toyota',
          model: 'Hilux',
          yearModel: '2024',
          client: 'Purefoods — San Miguel Corporation',
          branch: 'MGCAVITE',
          technician: 'System',
          odometer: 15000,
          type: 'Initial',
          date: new Date().toISOString().slice(0, 10),
        },
        itemResults: {},
        classification: { overallStatus: 'active', dispatchAllowed: true, failCriticalCount: 0, monitorCount: 0, totalBlockerCount: 0 },
        fmsStatus: 'synced',
        submittedAt: new Date().toISOString(),
        review_status: 'SENT_TO_CLIENT',
        createdBy: user?.uid || null,
      })
      await addDoc(collection(db, 'assessments'), {
        id: Date.now() + 1,
        rwaNumber: `RWA-2026-${(Date.now() + 1).toString().slice(-6)}`,
        header: {
          plate: 'TEST002',
          make: 'Toyota',
          model: 'Vios',
          yearModel: '2023',
          client: 'Purefoods — San Miguel Corporation',
          branch: 'MGCAVITE',
          technician: 'System',
          odometer: 28000,
          type: 'Initial',
          date: new Date().toISOString().slice(0, 10),
        },
        itemResults: {},
        classification: { overallStatus: 'conditional', dispatchAllowed: true, failCriticalCount: 0, monitorCount: 2, totalBlockerCount: 0 },
        fmsStatus: 'synced',
        submittedAt: new Date().toISOString(),
        review_status: 'SENT_TO_CLIENT',
        createdBy: user?.uid || null,
      })
      await addDoc(collection(db, 'assessments'), {
        id: Date.now() + 2,
        rwaNumber: `RWA-2026-${(Date.now() + 2).toString().slice(-6)}`,
        header: {
          plate: 'TEST003',
          make: 'Mitsubishi',
          model: 'L300',
          yearModel: '2022',
          client: 'Purefoods — San Miguel Corporation',
          branch: 'MGCAVITE',
          technician: 'System',
          odometer: 45000,
          type: 'Initial',
          date: new Date().toISOString().slice(0, 10),
        },
        itemResults: {},
        classification: { overallStatus: 'deferred', dispatchAllowed: false, failCriticalCount: 2, monitorCount: 1, totalBlockerCount: 2 },
        fmsStatus: 'synced',
        submittedAt: new Date().toISOString(),
        review_status: 'SENT_TO_CLIENT',
        createdBy: user?.uid || null,
      })
      setStatus('Done! 3 test vehicles created for Purefoods (TEST001, TEST002, TEST003). Refresh the fleet pages.')
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
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
        <button
          onClick={fixGmUser}
          style={{ background: '#7c3aed', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Set gm@test.com as Fleet Manager
        </button>
        <button
          onClick={createTestVehicle}
          style={{ background: '#d97706', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Create 3 Purefoods Vehicles
        </button>
      </div>
    </div>
  )
}
