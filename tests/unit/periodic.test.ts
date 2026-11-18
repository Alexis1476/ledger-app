import { describe, expect, it } from 'vitest'
import { parseFile } from '../../src/ledger/parser'
import { describeRule, formatRule, formatSchedule, occurrences, parseRule, scheduleState } from '../../src/ledger/periodic'

describe('periodic rules (hledger periodic transactions)', () => {
  it('parses the intervals hledger understands, with from / to', () => {
    expect(parseRule('monthly from 2026-11-15')).toEqual({ unit: 'month', every: 1, from: '2026-11-15' })
    expect(parseRule('every 3 months from 2026/12/31 to 2027-12-31')).toEqual({ unit: 'month', every: 3, from: '2026-12-31', to: '2027-12-31' })
    expect(parseRule('every 2 weeks from 2026-11-10')).toEqual({ unit: 'week', every: 2, from: '2026-11-10' })
    expect(parseRule('quarterly from 2026-01-01')).toEqual({ unit: 'month', every: 3, from: '2026-01-01' })
    expect(parseRule('biweekly from 2026-01-01')).toEqual({ unit: 'week', every: 2, from: '2026-01-01' })
    expect(parseRule('every year from 2026-02-01')).toEqual({ unit: 'year', every: 1, from: '2026-02-01' })
    // no start date or another syntax: left to hledger, read-only in the app
    expect(parseRule('monthly')).toBeUndefined()
    expect(parseRule('every 15th day of month')).toBeUndefined()
  })

  it('writes a canonical expression and a human description', () => {
    expect(formatRule({ unit: 'month', every: 3, from: '2026-12-31', to: '2027-12-31' })).toBe('quarterly from 2026-12-31 to 2027-12-31')
    expect(formatRule({ unit: 'week', every: 2, from: '2026-11-10' })).toBe('every 2 weeks from 2026-11-10')
    expect(describeRule({ unit: 'month', every: 1, from: '2026-01-01' })).toBe('Monthly')
    expect(describeRule({ unit: 'week', every: 2, from: '2026-01-01' })).toBe('Every 2 weeks')
  })

  it('generates the same dates as hledger print --forecast', () => {
    // checked with hledger 1.52: anchored on the start day, clipped to the month end, end excluded
    expect(occurrences(parseRule('monthly from 2026-01-31 to 2026-05-31')!, '2026-01-01', '2027-01-01')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ])
    expect(occurrences(parseRule('every 3 months from 2026-12-31')!, '2026-11-02', '2027-04-01')).toEqual(['2026-12-31', '2027-03-31'])
    expect(occurrences(parseRule('every 2 weeks from 2026-11-10')!, '2026-11-02', '2026-12-31')).toEqual([
      '2026-11-10',
      '2026-11-24',
      '2026-12-08',
      '2026-12-22'
    ])
    expect(occurrences(parseRule('weekly from 2026-01-01 to 2026-01-15')!, '2026-01-01', '2027-01-01')).toEqual(['2026-01-01', '2026-01-08'])
  })

  it('reads and writes a schedule block exactly', () => {
    const text = [
      '~ monthly from 2026-12-01  Landlord | Rent  ; via:app, id:01SCHED, skip:2027-01-01',
      '    expenses:home:rent                             1200.00 CHF',
      '    assets:bank:checking                          -1200.00 CHF'
    ].join('\n')
    const s = parseFile(text, 'journals/scheduled.journal').schedules[0]
    expect(s).toMatchObject({ id: '01SCHED', period: 'monthly from 2026-12-01', rule: { unit: 'month', every: 1, from: '2026-12-01' } })
    expect(s.tx).toMatchObject({ payee: 'Landlord', note: 'Rent', date: '2026-12-01' })
    expect(formatSchedule(s.rule!, s.tx)).toBe(text)
  })

  it('due occurrences: recorded and skipped ones are done, older ones are overdue', () => {
    const s = parseFile(
      ['~ monthly from 2026-09-15  Rent  ; id:R, skip:2026-10-15', '    expenses:rent  10.00 CHF', '    assets:bank'].join('\n'),
      'x.journal'
    ).schedules[0]
    const recorded = parseFile('2026-09-16 * Rent  ; schedule:R, planned:2026-09-15\n    expenses:rent  10.00 CHF\n    assets:bank\n', 'y').transactions
    const st = scheduleState(s, recorded, '2026-11-20', 30)
    expect(st.due).toEqual([
      { date: '2026-11-15', overdue: true },
      { date: '2026-12-15', overdue: false }
    ])
    expect(st.next).toBe('2026-12-15')
    expect(st.last).toBe('2026-09-15')
  })
})
