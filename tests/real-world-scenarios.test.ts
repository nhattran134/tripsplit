import { describe, it, expect } from 'vitest'
import { calculateBalances, simplifyDebts } from '../src/lib/settlement'
import { calculateEqualSplit } from '../src/lib/splits'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '../src/types'

// --- Helper factories ---

let idCounter = 0
const uid = () => `id-${++idCounter}`

const makeMember = (id: string, name: string, opts?: Partial<Member>): Member => ({
  id,
  trip_id: 'trip1',
  auth_uid: `auth-${id}`,
  name,
  color: '#000',
  is_admin: false,
  claimed: true,
  member_token: `token-${id}`,
  avatar_style: 'default',
  avatar_seed: 1,
  group_id: null,
  joined_at: '2026-01-01',
  deleted_at: null,
  ...opts,
})

const makeDeposit = (memberId: string, amount: number, currency = 'VND', rate = 1): Deposit => ({
  id: uid(),
  trip_id: 'trip1',
  member_id: memberId,
  amount,
  currency,
  rate_to_base: rate,
  note: '',
  created_at: '2026-01-01',
  deleted_at: null,
  version: 1,
})

const makeExpense = (
  memberId: string,
  amount: number,
  paidFrom: 'pool' | 'pocket',
  currency = 'VND',
  rate = 1,
  id?: string
): Expense => ({
  id: id ?? uid(),
  trip_id: 'trip1',
  member_id: memberId,
  amount,
  currency,
  rate_to_base: rate,
  category: 'other',
  description: '',
  date: '2026-01-01',
  split_type: 'equal',
  paid_from: paidFrom,
  receipt_url: null,
  created_at: '2026-01-01',
  deleted_at: null,
  version: 1,
})

const makeSplit = (expenseId: string, memberId: string, shareAmount: number): ExpenseSplit => ({
  id: uid(),
  expense_id: expenseId,
  member_id: memberId,
  share_amount: shareAmount,
})

const makeSettlement = (fromId: string, toId: string, amount: number): Settlement => ({
  id: uid(),
  trip_id: 'trip1',
  from_member_id: fromId,
  to_member_id: toId,
  amount,
  method: 'direct',
  note: '',
  created_at: '2026-01-02',
  deleted_at: null,
})

const getNet = (balances: { memberId: string; net: number }[], id: string) =>
  balances.find((b) => b.memberId === id)?.net ?? 0

// =============================================================================
// SCENARIO 1: Vietnamese group trip (pool model)
// =============================================================================
describe('Scenario 1: Vietnamese group trip (pool model)', () => {
  const members = ['an', 'binh', 'chi', 'dung', 'em', 'phuc'].map((id) =>
    makeMember(id, id.charAt(0).toUpperCase() + id.slice(1))
  )
  const allIds = members.map((m) => m.id)

  // Each deposits 3,000,000 VND
  const deposits = allIds.map((id) => makeDeposit(id, 3_000_000))

  // Budget holder (an) pays all from pool
  const eHotel = makeExpense('an', 8_000_000, 'pool', 'VND', 1, 'exp-hotel')
  const eDinner1 = makeExpense('an', 1_200_000, 'pool', 'VND', 1, 'exp-dinner1')
  const eDinner2 = makeExpense('an', 900_000, 'pool', 'VND', 1, 'exp-dinner2')
  const eTransport = makeExpense('an', 2_400_000, 'pool', 'VND', 1, 'exp-transport')
  const expenses = [eHotel, eDinner1, eDinner2, eTransport]

  // Splits
  const hotelSplits = allIds.map((id) => makeSplit('exp-hotel', id, 8_000_000 / 6))
  const dinner1Splits = allIds.map((id) => makeSplit('exp-dinner1', id, 1_200_000 / 6))
  // Dinner 2: only 4 people (an, binh, chi, dung)
  const dinner2Ids = ['an', 'binh', 'chi', 'dung']
  const dinner2Splits = dinner2Ids.map((id) => makeSplit('exp-dinner2', id, 900_000 / 4))
  const transportSplits = allIds.map((id) => makeSplit('exp-transport', id, 2_400_000 / 6))

  const allSplits = [...hotelSplits, ...dinner1Splits, ...dinner2Splits, ...transportSplits]

  it('total pool = 18M, total expenses = 12.5M, pool remaining = 5.5M', () => {
    const totalDeposits = deposits.reduce((s, d) => s + d.amount, 0)
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
    expect(totalDeposits).toBe(18_000_000)
    expect(totalExpenses).toBe(12_500_000)
  })

  it('each member net = deposits - their share of expenses', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])

    // Everyone deposited 3M
    // An, Binh, Chi, Dung share in all 4 expenses
    // Em, Phuc share in hotel + dinner1 + transport only
    const shareAll6 = (8_000_000 + 1_200_000 + 2_400_000) / 6 // 1,933,333.33...
    const shareDinner2_4 = 900_000 / 4 // 225,000

    // An's share: shareAll6 + shareDinner2_4
    const anExpected = 3_000_000 - shareAll6 - shareDinner2_4
    expect(getNet(balances, 'an')).toBeCloseTo(anExpected, 0)

    // Em's share: only the 3 pool expenses split by 6
    const emExpected = 3_000_000 - shareAll6
    expect(getNet(balances, 'em')).toBeCloseTo(emExpected, 0)
  })

  it('sum of all nets = pool remaining (5.5M)', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    const sumNets = balances.reduce((s, b) => s + b.net, 0)
    expect(sumNets).toBeCloseTo(5_500_000, 0)
  })
})

// =============================================================================
// SCENARIO 2: Mixed pool + pocket
// =============================================================================
describe('Scenario 2: Mixed pool + pocket payments', () => {
  const members = [
    makeMember('alice', 'Alice'),
    makeMember('bob', 'Bob'),
    makeMember('charlie', 'Charlie'),
    makeMember('dave', 'Dave'),
  ]
  const allIds = members.map((m) => m.id)

  // Only Alice and Bob deposit into pool
  const deposits = [
    makeDeposit('alice', 5_000_000),
    makeDeposit('bob', 5_000_000),
  ]

  // Hotel: 6M from pool, split 4
  const eHotel = makeExpense('alice', 6_000_000, 'pool', 'VND', 1, 'exp2-hotel')
  // Dinner: 800K paid by Charlie from pocket, split 4
  const eDinner = makeExpense('charlie', 800_000, 'pocket', 'VND', 1, 'exp2-dinner')
  // Taxi: 200K paid by Dave from pocket, split 2 (Charlie + Dave)
  const eTaxi = makeExpense('dave', 200_000, 'pocket', 'VND', 1, 'exp2-taxi')

  const expenses = [eHotel, eDinner, eTaxi]

  const hotelSplits = allIds.map((id) => makeSplit('exp2-hotel', id, 6_000_000 / 4))
  const dinnerSplits = allIds.map((id) => makeSplit('exp2-dinner', id, 800_000 / 4))
  const taxiSplits = ['charlie', 'dave'].map((id) => makeSplit('exp2-taxi', id, 200_000 / 2))

  const allSplits = [...hotelSplits, ...dinnerSplits, ...taxiSplits]

  it('Charlie gets credit for 800K pocket payment', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Charlie: +800K (pocket credit) - 1.5M (hotel share) - 200K (dinner share) - 100K (taxi share)
    // = 800K - 1_500_000 - 200_000 - 100_000 = -1_000_000
    expect(getNet(balances, 'charlie')).toBe(-1_000_000)
  })

  it('Dave gets credit for 200K pocket payment', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Dave: +200K (pocket credit) - 1.5M (hotel share) - 200K (dinner share) - 100K (taxi share)
    // = 200K - 1_500_000 - 200_000 - 100_000 = -1_600_000
    expect(getNet(balances, 'dave')).toBe(-1_600_000)
  })

  it('pool balance = 10M - 6M = 4M (structural surplus)', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Total deposits = 10M, total shares = 6M + 800K + 200K = 7M
    // Pocket credits = 800K + 200K = 1M
    // Sum of nets = deposits + pocket_credits - shares = 10M + 1M - 7M = 4M
    const sumNets = balances.reduce((s, b) => s + b.net, 0)
    expect(sumNets).toBeCloseTo(4_000_000, 0)
  })

  it('Alice and Bob have positive net (depositors)', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Alice: 5M - 1.5M - 200K = 3,300,000
    expect(getNet(balances, 'alice')).toBe(3_300_000)
    // Bob: 5M - 1.5M - 200K = 3,300,000
    expect(getNet(balances, 'bob')).toBe(3_300_000)
  })
})

// =============================================================================
// SCENARIO 3: Couple (weighted split)
// =============================================================================
describe('Scenario 3: Couple with weighted split', () => {
  const members = [
    makeMember('alice', 'Alice'),
    makeMember('bob', 'Bob'),
    makeMember('charlie', 'Charlie'),
    makeMember('dave', 'Dave'),
    makeMember('eve', 'Eve'),
    makeMember('frank', 'Frank'),
  ]

  // Alice+Bob are a couple (0.5 weight each), others weight 1
  const weights: Record<string, number> = {
    alice: 0.5,
    bob: 0.5,
    charlie: 1,
    dave: 1,
    eve: 1,
    frank: 1,
  }

  it('calculates weighted split correctly for 600K VND dinner', () => {
    const memberIds = members.map((m) => m.id)
    const result = calculateEqualSplit(600_000, memberIds, 'VND', weights)

    // Total weight = 0.5+0.5+1+1+1+1 = 5
    // Alice: 600K * 0.5/5 = 60K
    // Bob: 600K * 0.5/5 = 60K
    // Others: 600K * 1/5 = 120K each
    expect(result.find((r) => r.member_id === 'alice')?.share_amount).toBe(60_000)
    expect(result.find((r) => r.member_id === 'bob')?.share_amount).toBe(60_000)
    expect(result.find((r) => r.member_id === 'charlie')?.share_amount).toBe(120_000)
    expect(result.find((r) => r.member_id === 'dave')?.share_amount).toBe(120_000)
    expect(result.find((r) => r.member_id === 'eve')?.share_amount).toBe(120_000)
    expect(result.find((r) => r.member_id === 'frank')?.share_amount).toBe(120_000)
  })

  it('sum of weighted shares equals total amount', () => {
    const memberIds = members.map((m) => m.id)
    const result = calculateEqualSplit(600_000, memberIds, 'VND', weights)
    const total = result.reduce((s, r) => s + r.share_amount, 0)
    expect(total).toBe(600_000)
  })

  it('weighted split integrates with calculateBalances', () => {
    // Everyone deposits equally 120K
    const deposits = members.map((m) => makeDeposit(m.id, 120_000))
    const expense = makeExpense('alice', 600_000, 'pool', 'VND', 1, 'exp3-dinner')

    const memberIds = members.map((m) => m.id)
    const splitResult = calculateEqualSplit(600_000, memberIds, 'VND', weights)
    const splits = splitResult.map((r) => makeSplit('exp3-dinner', r.member_id, r.share_amount))

    const balances = calculateBalances(members, deposits, [expense], splits, [])

    // Alice: 120K deposit - 60K share = +60K
    expect(getNet(balances, 'alice')).toBe(60_000)
    // Charlie: 120K deposit - 120K share = 0
    expect(getNet(balances, 'charlie')).toBe(0)
  })
})

// =============================================================================
// SCENARIO 4: Multi-currency Japan trip
// =============================================================================
describe('Scenario 4: Multi-currency Japan trip', () => {
  const members = [
    makeMember('alice', 'Alice'),
    makeMember('bob', 'Bob'),
    makeMember('charlie', 'Charlie'),
  ]

  // Base currency: VND. Deposits in VND.
  const deposits = [
    makeDeposit('alice', 5_000_000, 'VND', 1),
    makeDeposit('bob', 5_000_000, 'VND', 1),
    makeDeposit('charlie', 5_000_000, 'VND', 1),
  ]

  // Ramen: 1,200 JPY at rate 172 VND/JPY = 206,400 VND (pool, split 3)
  const eRamen = makeExpense('alice', 1_200, 'pool', 'JPY', 172, 'exp4-ramen')
  // Train: 5,000 JPY at rate 172 = 860,000 VND (pool, split 3)
  const eTrain = makeExpense('bob', 5_000, 'pool', 'JPY', 172, 'exp4-train')
  // Souvenir: 3,000 JPY at rate 170 = 510,000 VND (pocket by Alice, split 2: Alice+Bob)
  const eSouvenir = makeExpense('alice', 3_000, 'pocket', 'JPY', 170, 'exp4-souvenir')

  const expenses = [eRamen, eTrain, eSouvenir]

  // Splits are in base currency (VND)
  const ramenBase = 1_200 * 172 // 206,400
  const trainBase = 5_000 * 172 // 860,000
  const souvenirBase = 3_000 * 170 // 510,000

  const ramenSplits = members.map((m) => makeSplit('exp4-ramen', m.id, ramenBase / 3))
  const trainSplits = members.map((m) => makeSplit('exp4-train', m.id, trainBase / 3))
  const souvenirSplits = ['alice', 'bob'].map((id) => makeSplit('exp4-souvenir', id, souvenirBase / 2))

  const allSplits = [...ramenSplits, ...trainSplits, ...souvenirSplits]

  it('currency conversion uses stored rate per transaction', () => {
    // Ramen and Train use rate 172, Souvenir uses rate 170
    expect(eRamen.rate_to_base).toBe(172)
    expect(eTrain.rate_to_base).toBe(172)
    expect(eSouvenir.rate_to_base).toBe(170)
  })

  it('base amounts are correct after conversion', () => {
    expect(ramenBase).toBe(206_400)
    expect(trainBase).toBe(860_000)
    expect(souvenirBase).toBe(510_000)
  })

  it('Alice gets pocket credit for souvenir in VND equivalent', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])

    // Alice: deposit 5M + pocket credit (3000*170=510K)
    //   - ramen share (206400/3=68800) - train share (860000/3=286666.67) - souvenir share (510000/2=255000)
    // = 5M + 510K - 68800 - 286666.67 - 255000
    const aliceExpected = 5_000_000 + 510_000 - (ramenBase / 3) - (trainBase / 3) - (souvenirBase / 2)
    expect(getNet(balances, 'alice')).toBeCloseTo(aliceExpected, 0)
  })

  it('Charlie has no souvenir share (not included)', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])

    // Charlie: deposit 5M - ramen share - train share (no souvenir)
    const charlieExpected = 5_000_000 - (ramenBase / 3) - (trainBase / 3)
    expect(getNet(balances, 'charlie')).toBeCloseTo(charlieExpected, 0)
  })
})

// =============================================================================
// SCENARIO 5: Settlement with existing partial payment
// =============================================================================
describe('Scenario 5: Settlement with partial payment', () => {
  const members = [
    makeMember('alice', 'Alice'),
    makeMember('bob', 'Bob'),
    makeMember('charlie', 'Charlie'),
  ]

  // Set up so: Alice net=+500K, Bob net=-300K, Charlie net=-200K
  // Alice deposits 1M, Bob deposits 200K, Charlie deposits 300K
  // One expense 1M from pool, split equally (333333 each)
  const deposits = [
    makeDeposit('alice', 1_000_000),
    makeDeposit('bob', 200_000),
    makeDeposit('charlie', 300_000),
  ]

  const expense = makeExpense('alice', 1_000_000, 'pool', 'VND', 1, 'exp5-all')
  // Split: use calculateEqualSplit logic for VND (0 decimals)
  // 1M / 3 = 333333, 333333, 333334 (remainder to index 0)
  const splits = [
    makeSplit('exp5-all', 'alice', 333_334),
    makeSplit('exp5-all', 'bob', 333_333),
    makeSplit('exp5-all', 'charlie', 333_333),
  ]

  it('initial balances before settlement', () => {
    const balances = calculateBalances(members, deposits, [expense], splits, [])
    // Alice: 1M - 333334 = 666666
    // Bob: 200K - 333333 = -133333
    // Charlie: 300K - 333333 = -33333
    expect(getNet(balances, 'alice')).toBe(666_666)
    expect(getNet(balances, 'bob')).toBe(-133_333)
    expect(getNet(balances, 'charlie')).toBe(-33_333)
  })

  it('simplifyDebts produces correct transfers', () => {
    const balances = calculateBalances(members, deposits, [expense], splits, [])
    const transfers = simplifyDebts(balances, members)

    // Bob → Alice and Charlie → Alice
    expect(transfers.length).toBe(2)
    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0)
    expect(totalTransferred).toBeCloseTo(166_666, 0)
  })

  it('after Bob settles fully, only Charlie debt remains', () => {
    // Bob pays Alice 133333
    const settlement = makeSettlement('bob', 'alice', 133_333)

    const balances = calculateBalances(members, deposits, [expense], splits, [settlement])

    // Alice: 666666 - 133333 = 533333
    expect(getNet(balances, 'alice')).toBe(533_333)
    // Bob: -133333 + 133333 = 0
    expect(getNet(balances, 'bob')).toBe(0)
    // Charlie: still -33333
    expect(getNet(balances, 'charlie')).toBe(-33_333)

    const transfers = simplifyDebts(balances, members)
    // Only Charlie → Alice remains
    expect(transfers.length).toBe(1)
    expect(transfers[0].from.id).toBe('charlie')
    expect(transfers[0].to.id).toBe('alice')
    expect(transfers[0].amount).toBe(33_333)
  })
})

// =============================================================================
// SCENARIO 6: Member deleted mid-trip
// =============================================================================
describe('Scenario 6: Member soft-deleted mid-trip', () => {
  const members = [
    makeMember('alice', 'Alice'),
    makeMember('bob', 'Bob'),
    makeMember('charlie', 'Charlie'),
    makeMember('dave', 'Dave', { deleted_at: '2026-01-05' }), // soft-deleted
  ]

  // Dave deposited before being deleted
  const deposits = [
    makeDeposit('alice', 1_000_000),
    makeDeposit('bob', 1_000_000),
    makeDeposit('charlie', 1_000_000),
    makeDeposit('dave', 1_000_000),
  ]

  // Expense made before Dave left: 2M from pool, split 4
  const expense = makeExpense('alice', 2_000_000, 'pool', 'VND', 1, 'exp6-hotel')
  const splits = ['alice', 'bob', 'charlie', 'dave'].map((id) =>
    makeSplit('exp6-hotel', id, 500_000)
  )

  it('soft-deleted member is still included in balance calculation', () => {
    const balances = calculateBalances(members, deposits, [expense], splits, [])

    // Dave: 1M - 500K = 500K (still has positive balance)
    expect(getNet(balances, 'dave')).toBe(500_000)
    // All members: 1M - 500K = 500K each
    expect(getNet(balances, 'alice')).toBe(500_000)
  })

  it('settlement shows debts for deleted member', () => {
    // Dave deposited less than his share — he's a debtor even though deleted
    const unevenDeposits = [
      makeDeposit('alice', 4_000_000),
      makeDeposit('bob', 1_000_000),
      makeDeposit('charlie', 1_000_000),
      makeDeposit('dave', 500_000), // Only 500K
    ]
    // 4M expense split 4 ways = 1M each
    const expense2 = makeExpense('alice', 4_000_000, 'pool', 'VND', 1, 'exp6-dinner')
    const splits2 = ['alice', 'bob', 'charlie', 'dave'].map((id) =>
      makeSplit('exp6-dinner', id, 1_000_000)
    )

    const balances = calculateBalances(members, unevenDeposits, [expense2], splits2, [])

    // Alice: 4M - 1M = +3M (creditor)
    expect(getNet(balances, 'alice')).toBe(3_000_000)
    // Dave: 500K - 1M = -500K (debtor, even though deleted)
    expect(getNet(balances, 'dave')).toBe(-500_000)

    const transfers = simplifyDebts(balances, members)
    // Dave should appear in transfers as a debtor
    const daveTransfer = transfers.find((t) => t.from.id === 'dave')
    expect(daveTransfer).toBeDefined()
    expect(daveTransfer!.amount).toBeGreaterThan(0)
  })
})

// =============================================================================
// SCENARIO 7: Zero deposits, all pocket (Splitwise mode)
// =============================================================================
describe('Scenario 7: Zero deposits, all pocket (Splitwise mode)', () => {
  const members = [
    makeMember('alice', 'Alice'),
    makeMember('bob', 'Bob'),
    makeMember('charlie', 'Charlie'),
    makeMember('dave', 'Dave'),
  ]
  const allIds = members.map((m) => m.id)

  // No deposits at all
  const deposits: Deposit[] = []

  // Alice pays dinner 400K (pocket, split 4)
  const eDinner = makeExpense('alice', 400_000, 'pocket', 'VND', 1, 'exp7-dinner')
  // Bob pays taxi 100K (pocket, split 2: Alice+Bob)
  const eTaxi = makeExpense('bob', 100_000, 'pocket', 'VND', 1, 'exp7-taxi')
  // Charlie pays hotel 800K (pocket, split 4)
  const eHotel = makeExpense('charlie', 800_000, 'pocket', 'VND', 1, 'exp7-hotel')

  const expenses = [eDinner, eTaxi, eHotel]

  const dinnerSplits = allIds.map((id) => makeSplit('exp7-dinner', id, 100_000))
  const taxiSplits = ['alice', 'bob'].map((id) => makeSplit('exp7-taxi', id, 50_000))
  const hotelSplits = allIds.map((id) => makeSplit('exp7-hotel', id, 200_000))

  const allSplits = [...dinnerSplits, ...taxiSplits, ...hotelSplits]

  it('Alice net = pocket credit - shares = 400K - 350K = +50K', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Alice: credit 400K, shares: dinner 100K + taxi 50K + hotel 200K = 350K
    expect(getNet(balances, 'alice')).toBe(50_000)
  })

  it('Bob net = 100K - 350K = -250K', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Bob: credit 100K, shares: dinner 100K + taxi 50K + hotel 200K = 350K
    expect(getNet(balances, 'bob')).toBe(-250_000)
  })

  it('Charlie net = 800K - 300K = +500K', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Charlie: credit 800K, shares: dinner 100K + hotel 200K = 300K (no taxi share)
    expect(getNet(balances, 'charlie')).toBe(500_000)
  })

  it('Dave net = 0 - 300K = -300K', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    // Dave: no credit, shares: dinner 100K + hotel 200K = 300K
    expect(getNet(balances, 'dave')).toBe(-300_000)
  })

  it('zero-sum (no pool surplus)', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    const sum = balances.reduce((s, b) => s + b.net, 0)
    expect(sum).toBe(0)
  })

  it('simplifyDebts settles correctly', () => {
    const balances = calculateBalances(members, deposits, expenses, allSplits, [])
    const transfers = simplifyDebts(balances, members)

    // Total owed: 250K + 300K = 550K = total credited: 50K + 500K
    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0)
    expect(totalTransferred).toBe(550_000)
    expect(transfers.length).toBeLessThanOrEqual(3) // N-1
  })
})

// =============================================================================
// SCENARIO 8: Equal split remainder rotation
// =============================================================================
describe('Scenario 8: Equal split remainder rotation', () => {
  const memberIds = ['a', 'b', 'c']

  it('remainder goes to index 0 for expense 0', () => {
    const result = calculateEqualSplit(100, memberIds, 'VND', undefined, 0)
    expect(result.map((r) => r.share_amount)).toEqual([34, 33, 33])
  })

  it('remainder goes to index 1 for expense 1', () => {
    const result = calculateEqualSplit(100, memberIds, 'VND', undefined, 1)
    expect(result.map((r) => r.share_amount)).toEqual([33, 34, 33])
  })

  it('remainder goes to index 2 for expense 2', () => {
    const result = calculateEqualSplit(100, memberIds, 'VND', undefined, 2)
    expect(result.map((r) => r.share_amount)).toEqual([33, 33, 34])
  })

  it('wraps around: index 3 → member 0', () => {
    const result = calculateEqualSplit(100, memberIds, 'VND', undefined, 3)
    expect(result.map((r) => r.share_amount)).toEqual([34, 33, 33])
  })

  it('sum always equals original amount regardless of rotation', () => {
    for (let i = 0; i < 10; i++) {
      const result = calculateEqualSplit(100, memberIds, 'VND', undefined, i)
      const total = result.reduce((s, r) => s + r.share_amount, 0)
      expect(total).toBe(100)
    }
  })

  it('works with USD (2 decimal places)', () => {
    // 100 USD / 3 = 33.33 each, remainder 0.01
    const result0 = calculateEqualSplit(100, memberIds, 'USD', undefined, 0)
    expect(result0[0].share_amount).toBe(33.34)
    expect(result0[1].share_amount).toBe(33.33)
    expect(result0[2].share_amount).toBe(33.33)

    const result1 = calculateEqualSplit(100, memberIds, 'USD', undefined, 1)
    expect(result1[0].share_amount).toBe(33.33)
    expect(result1[1].share_amount).toBe(33.34)
    expect(result1[2].share_amount).toBe(33.33)
  })
})

// =============================================================================
// SCENARIO 9: Large group (10 people) with debt simplification
// =============================================================================
describe('Scenario 9: Large group (10 people) debt simplification', () => {
  const memberIds = Array.from({ length: 10 }, (_, i) => `m${i}`)
  const members = memberIds.map((id) => makeMember(id, `Member ${id}`))

  // Various deposits: some deposit more, some less
  const deposits = [
    makeDeposit('m0', 2_000_000),
    makeDeposit('m1', 1_500_000),
    makeDeposit('m2', 1_000_000),
    makeDeposit('m3', 500_000),
    makeDeposit('m4', 3_000_000),
    makeDeposit('m5', 0),
    makeDeposit('m6', 0),
    makeDeposit('m7', 800_000),
    makeDeposit('m8', 200_000),
    makeDeposit('m9', 1_000_000),
  ]

  // Total deposited = 10M
  // Big expense from pool: 10M split 10 ways = 1M each
  const expense = makeExpense('m0', 10_000_000, 'pool', 'VND', 1, 'exp9-trip')
  const splits = memberIds.map((id) => makeSplit('exp9-trip', id, 1_000_000))

  it('produces at most N-1 (9) transfers', () => {
    const balances = calculateBalances(members, deposits, [expense], splits, [])
    const transfers = simplifyDebts(balances, members)
    expect(transfers.length).toBeLessThanOrEqual(9)
  })

  it('total transferred equals total owed', () => {
    const balances = calculateBalances(members, deposits, [expense], splits, [])
    const transfers = simplifyDebts(balances, members)

    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0)
    // Total owed = sum of all negative balances (absolute)
    const totalOwed = balances
      .filter((b) => b.net < 0)
      .reduce((s, b) => s + Math.abs(b.net), 0)

    expect(totalTransferred).toBeCloseTo(totalOwed, 0)
  })

  it('all transfers flow from debtors to creditors', () => {
    const balances = calculateBalances(members, deposits, [expense], splits, [])
    const transfers = simplifyDebts(balances, members)
    const balanceMap = new Map(balances.map((b) => [b.memberId, b.net]))

    for (const transfer of transfers) {
      // "from" should be a debtor (negative net before settlement)
      expect(balanceMap.get(transfer.from.id)!).toBeLessThan(0)
      // "to" should be a creditor (positive net before settlement)
      expect(balanceMap.get(transfer.to.id)!).toBeGreaterThan(0)
    }
  })

  it('specific balances are correct', () => {
    const balances = calculateBalances(members, deposits, [expense], splits, [])

    // m0: deposited 2M, share 1M → net = +1M
    expect(getNet(balances, 'm0')).toBe(1_000_000)
    // m5: deposited 0, share 1M → net = -1M
    expect(getNet(balances, 'm5')).toBe(-1_000_000)
    // m4: deposited 3M, share 1M → net = +2M
    expect(getNet(balances, 'm4')).toBe(2_000_000)
  })
})

// =============================================================================
// SCENARIO 10: Edge case — single member trip
// =============================================================================
describe('Scenario 10: Single member trip', () => {
  const members = [makeMember('solo', 'Solo Traveler')]

  it('net = 0 when deposit equals expense (pool model)', () => {
    const deposits = [makeDeposit('solo', 2_000_000)]
    const expense = makeExpense('solo', 2_000_000, 'pool', 'VND', 1, 'exp10-all')
    const splits = [makeSplit('exp10-all', 'solo', 2_000_000)]

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    expect(getNet(balances, 'solo')).toBe(0)
  })

  it('positive net when deposited more than spent', () => {
    const deposits = [makeDeposit('solo', 3_000_000)]
    const expense = makeExpense('solo', 2_000_000, 'pool', 'VND', 1, 'exp10-partial')
    const splits = [makeSplit('exp10-partial', 'solo', 2_000_000)]

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    expect(getNet(balances, 'solo')).toBe(1_000_000)
  })

  it('simplifyDebts returns empty for single member', () => {
    const deposits = [makeDeposit('solo', 2_000_000)]
    const expense = makeExpense('solo', 2_000_000, 'pool', 'VND', 1, 'exp10-solo')
    const splits = [makeSplit('exp10-solo', 'solo', 2_000_000)]

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    const transfers = simplifyDebts(balances, members)
    expect(transfers).toEqual([])
  })

  it('pocket payment with single member nets to zero', () => {
    // Solo pays 500K from pocket, split to self
    const expense = makeExpense('solo', 500_000, 'pocket', 'VND', 1, 'exp10-pocket')
    const splits = [makeSplit('exp10-pocket', 'solo', 500_000)]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // Credit 500K (pocket) - share 500K = 0
    expect(getNet(balances, 'solo')).toBe(0)
  })
})
