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

  const revertInvoice = async () => {
    setStatus('Reverting invoice for III0495...')
    try {
      const { getDocs, query, where, collection: col, doc: docRef, updateDoc: updDoc, serverTimestamp: srvTs } = await import('firebase/firestore')
      const results = []

      // Void branch invoices for III0495
      const invSnap = await getDocs(query(col(db, 'branchInvoices'), where('plateNo', '==', 'III0495')))
      for (const d of invSnap.docs) {
        try {
          await updDoc(docRef(db, 'branchInvoices', d.id), { status: 'VOID', updatedAt: srvTs() })
          results.push('Invoice voided')
        } catch (e) { results.push('Invoice void failed: ' + e.message) }
      }

      // Reset quotation's branchInvoice fields
      const qSnap = await getDocs(query(col(db, 'serviceReceipts'), where('plateNo', '==', 'III0495'), where('kind', '==', 'quotation')))
      for (const d of qSnap.docs) {
        try {
          await updDoc(docRef(db, 'serviceReceipts', d.id), {
            branchInvoiceId: null,
            branchInvoiceCode: null,
            branchInvoicedAt: null,
            updatedAt: srvTs(),
          })
          results.push('Quotation reset')
        } catch (e) { results.push('Quotation reset failed: ' + e.message) }
      }

      // Reset appointment back to ONGOING
      const apptSnap = await getDocs(query(col(db, 'appointments'), where('plateNo', '==', 'III0495')))
      for (const d of apptSnap.docs) {
        if (d.data().status === 'COMPLETED') {
          try {
            await updDoc(docRef(db, 'appointments', d.id), {
              status: 'ONGOING',
              note: 'Reverted for testing',
              updatedAt: srvTs(),
            })
            results.push('Appointment → ONGOING')
          } catch (e) { results.push('Appointment update failed: ' + e.message) }
        }
      }

      setStatus('Results: ' + results.join(' | '))
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const RETAIN_PLATES = new Set([
    'CCM9994', 'LAL2769', 'NIG3247', 'CCM1360', 'LCV2906', 'NCR6634',
    'NFI2565', 'NEO1121', 'MBF9221', 'NHL3196', 'DAB5472', 'NBQ8573',
    'NGF4649', 'NED6944',
  ])
  const normPlate = (p) => String(p || '').toUpperCase().replace(/\s+/g, '')

  const cleanupCollection = async (colName, plateField) => {
    const { getDocs, deleteDoc, collection: col, doc: docRef } = await import('firebase/firestore')
    const snap = await getDocs(col(db, colName))
    let deleted = 0, retained = 0, failed = 0
    for (const d of snap.docs) {
      const plate = normPlate(d.data()?.[plateField])
      if (RETAIN_PLATES.has(plate)) { retained++; continue }
      try { await deleteDoc(docRef(db, colName, d.id)); deleted++ }
      catch { failed++ }
    }
    return { deleted, retained, failed }
  }

  const cleanupAll = async () => {
    setStatus('Cleaning up all collections...')
    try {
      const results = []

      // Assessments (use header.plate, not a flat field)
      setStatus('Cleaning assessments...')
      const { getDocs, deleteDoc, collection: col, doc: docRef } = await import('firebase/firestore')
      const aSnap = await getDocs(col(db, 'assessments'))
      let aDel = 0, aRet = 0, aFail = 0
      for (const d of aSnap.docs) {
        const plate = normPlate(d.data()?.header?.plate)
        if (RETAIN_PLATES.has(plate)) { aRet++; continue }
        try { await deleteDoc(docRef(db, 'assessments', d.id)); aDel++ }
        catch { aFail++ }
      }
      results.push(`Assessments: ${aRet} kept, ${aDel} deleted, ${aFail} failed`)

      // Appointments
      setStatus('Cleaning appointments...')
      const apSnap = await getDocs(col(db, 'appointments'))
      let apDel = 0, apRet = 0, apFail = 0
      for (const d of apSnap.docs) {
        const plate = normPlate(d.data()?.plateNo)
        if (RETAIN_PLATES.has(plate)) { apRet++; continue }
        try { await deleteDoc(docRef(db, 'appointments', d.id)); apDel++ }
        catch { apFail++ }
      }
      results.push(`Bookings: ${apRet} kept, ${apDel} deleted, ${apFail} failed`)

      // Service Receipts / Quotations
      setStatus('Cleaning quotations/receipts...')
      const srSnap = await getDocs(col(db, 'serviceReceipts'))
      let srDel = 0, srRet = 0, srFail = 0
      for (const d of srSnap.docs) {
        const plate = normPlate(d.data()?.plateNo)
        if (RETAIN_PLATES.has(plate)) { srRet++; continue }
        try { await deleteDoc(docRef(db, 'serviceReceipts', d.id)); srDel++ }
        catch { srFail++ }
      }
      results.push(`Quotations/Receipts: ${srRet} kept, ${srDel} deleted, ${srFail} failed`)

      // Branch Invoices
      setStatus('Cleaning branch invoices...')
      const biSnap = await getDocs(col(db, 'branchInvoices'))
      let biDel = 0, biRet = 0, biFail = 0
      for (const d of biSnap.docs) {
        const plate = normPlate(d.data()?.plateNo)
        if (RETAIN_PLATES.has(plate)) { biRet++; continue }
        try { await deleteDoc(docRef(db, 'branchInvoices', d.id)); biDel++ }
        catch { biFail++ }
      }
      results.push(`Branch Invoices: ${biRet} kept, ${biDel} deleted, ${biFail} failed`)

      // Client Invoices
      setStatus('Cleaning client invoices...')
      const ciSnap = await getDocs(col(db, 'clientInvoices'))
      let ciDel = 0, ciRet = 0, ciFail = 0
      for (const d of ciSnap.docs) {
        const plate = normPlate(d.data()?.plateNo)
        if (RETAIN_PLATES.has(plate)) { ciRet++; continue }
        try { await deleteDoc(docRef(db, 'clientInvoices', d.id)); ciDel++ }
        catch { ciFail++ }
      }
      results.push(`Client Invoices: ${ciRet} kept, ${ciDel} deleted, ${ciFail} failed`)

      // Notifications
      setStatus('Cleaning notifications...')
      const nSnap = await getDocs(col(db, 'notifications'))
      let nDel = 0, nRet = 0, nFail = 0
      for (const d of nSnap.docs) {
        const plate = normPlate(d.data()?.plateNo)
        if (!plate || RETAIN_PLATES.has(plate)) { nRet++; continue }
        try { await deleteDoc(docRef(db, 'notifications', d.id)); nDel++ }
        catch { nFail++ }
      }
      results.push(`Notifications: ${nRet} kept, ${nDel} deleted, ${nFail} failed`)

      setStatus(results.join('\n'))
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const cleanupUsers = async () => {
    const RETAIN_EMAILS = new Set(['edejercito@gmail.com', 'fleet.mgr@test.com'])
    setStatus('Cleaning up users...')
    try {
      const { getDocs, deleteDoc, collection: col, doc: docRef } = await import('firebase/firestore')
      const snap = await getDocs(col(db, 'users'))
      let deleted = 0, retained = 0, failed = 0
      for (const d of snap.docs) {
        const email = (d.data()?.email || '').toLowerCase().trim()
        if (RETAIN_EMAILS.has(email)) { retained++; continue }
        try { await deleteDoc(docRef(db, 'users', d.id)); deleted++ }
        catch { failed++ }
      }
      // Also clean pendingInvites
      const piSnap = await getDocs(col(db, 'pendingInvites'))
      let piDel = 0
      for (const d of piSnap.docs) {
        try { await deleteDoc(docRef(db, 'pendingInvites', d.id)); piDel++ }
        catch {}
      }
      setStatus(`Users: ${retained} kept, ${deleted} deleted, ${failed} failed | Pending invites: ${piDel} deleted`)
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const cleanupVehicles = async () => {
    const RETAIN = new Set([
      'CCM9994', 'LAL2769', 'NIG3247', 'CCM1360', 'LCV2906', 'NCR6634',
      'NFI2565', 'NEO1121', 'MBF9221', 'NHL3196', 'DAB5472', 'NBQ8573',
      'NGF4649', 'NED6944',
    ])
    setStatus('Scanning assessments...')
    try {
      const { getDocs, deleteDoc, collection: col, doc: docRef } = await import('firebase/firestore')
      const snap = await getDocs(col(db, 'assessments'))
      let deleted = 0
      let retained = 0
      let failed = 0
      for (const d of snap.docs) {
        const plate = String(d.data()?.header?.plate || '').toUpperCase().replace(/\s+/g, '')
        if (RETAIN.has(plate)) {
          retained++
          continue
        }
        try {
          await deleteDoc(docRef(db, 'assessments', d.id))
          deleted++
        } catch {
          failed++
        }
      }
      setStatus(`Done! Retained: ${retained} | Deleted: ${deleted} | Failed: ${failed}`)
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const FLEET_VEHICLES = [
    { plate: 'CCM9994', make: 'Mitsubishi', model: 'L300', year: '2020' },
    { plate: 'LAL2769', make: 'Mitsubishi', model: 'Canter', year: '2019' },
    { plate: 'NIG3247', make: 'Isuzu', model: 'NLR', year: '2022' },
    { plate: 'CCM1360', make: 'Mitsubishi', model: 'L300', year: '2021' },
    { plate: 'LCV2906', make: 'Isuzu', model: 'NLR', year: '2021' },
    { plate: 'NCR6634', make: 'Mitsubishi', model: 'Canter', year: '2020' },
    { plate: 'NFI2565', make: 'Isuzu', model: 'ELF', year: '2022' },
    { plate: 'NEO1121', make: 'Mitsubishi', model: 'L300', year: '2023' },
    { plate: 'MBF9221', make: 'Isuzu', model: 'NLR', year: '2020' },
    { plate: 'NHL3196', make: 'Mitsubishi', model: 'Canter', year: '2021' },
    { plate: 'DAB5472', make: 'Isuzu', model: 'ELF', year: '2019' },
    { plate: 'NBQ8573', make: 'Mitsubishi', model: 'L300', year: '2022' },
    { plate: 'NGF4649', make: 'Isuzu', model: 'NLR', year: '2023' },
    { plate: 'NED6944', make: 'Mitsubishi', model: 'Canter', year: '2021' },
  ]

  const seedVehicles = async () => {
    setStatus('Seeding 14 fleet vehicles...')
    try {
      let created = 0, failed = 0
      for (const v of FLEET_VEHICLES) {
        try {
          await addDoc(collection(db, 'assessments'), {
            id: Date.now() + created,
            rwaNumber: `RWA-SEED-${v.plate}`,
            type: '_vehicleRegistration',
            header: {
              plate: v.plate,
              make: v.make,
              model: v.model,
              yearModel: v.year,
              client: 'PUREFOODS',
              branch: 'MGCAVITE',
              technician: 'System',
              odometer: 0,
              type: 'Initial',
              date: new Date().toISOString().slice(0, 10),
            },
            vehicleMeta: { assignedTo: '', mobileNo: '' },
            itemResults: {},
            classification: { overallStatus: 'active', dispatchAllowed: true, failCriticalCount: 0, monitorCount: 0, totalBlockerCount: 0 },
            fmsStatus: 'synced',
            submittedAt: new Date().toISOString(),
            review_status: 'SENT_TO_CLIENT',
            createdBy: user?.uid || null,
          })
          created++
        } catch { failed++ }
      }
      setStatus(`Done! Created: ${created} | Failed: ${failed}. Refresh fleet pages to see vehicles.`)
    } catch (err) {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 16 }}>Fix User</h1>
      <p style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{status}</p>
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
        <button
          onClick={revertInvoice}
          style={{ background: '#dc2626', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Revert Invoice (III0495)
        </button>
        <button
          onClick={cleanupVehicles}
          style={{ background: '#991b1b', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Cleanup Vehicles (retain 14)
        </button>
        <button
          onClick={cleanupAll}
          style={{ background: '#450a0a', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Cleanup ALL (bookings, quotes, invoices, notifications)
        </button>
        <button
          onClick={cleanupUsers}
          style={{ background: '#3b0764', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Cleanup Users (retain 2)
        </button>
        <button
          onClick={seedVehicles}
          style={{ background: '#047857', color: 'white', padding: '10px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
        >
          Seed 14 Fleet Vehicles
        </button>
      </div>
    </div>
  )
}
