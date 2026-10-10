import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SavingsBook } from '../types';
import { formatDecimal } from '../utils/formatters';

interface CashflowBook extends Pick<SavingsBook, 'maturityDate' | 'principal'> {
  calculatedTermInterest: number;
}

interface CashflowMaturityChartProps {
  books: CashflowBook[];
}

export default function CashflowMaturityChart({ books }: CashflowMaturityChartProps) {
  const data = books
    .reduce<
      {
        monthKey: string;
        label: string;
        principalMillion: number;
        interestMillion: number;
      }[]
    >((acc, book) => {
      const monthKey = book.maturityDate.slice(0, 7);
      const [year, month] = monthKey.split('-');
      const label = `T${parseInt(month, 10)}/${year.slice(2)}`;
      const existing = acc.find((item) => item.monthKey === monthKey);

      if (existing) {
        existing.principalMillion += Math.round(book.principal / 1_000_000);
        existing.interestMillion += Math.round(book.calculatedTermInterest / 1_000_000);
      } else {
        acc.push({
          monthKey,
          label,
          principalMillion: Math.round(book.principal / 1_000_000),
          interestMillion: Math.round(book.calculatedTermInterest / 1_000_000),
        });
      }
      return acc;
    }, [])
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#cbd5e1' }} />
        <YAxis
          tick={{ fontSize: 10, fill: '#cbd5e1' }}
          tickFormatter={(value) => `${formatDecimal(value / 1000, 1)}T`}
        />
        <Tooltip
          formatter={(value, name) => [
            `${Number(value).toLocaleString('vi-VN')} Tr VNĐ`,
            name === 'principalMillion' ? 'Gốc' : 'Lãi',
          ]}
          contentStyle={{
            backgroundColor: '#0f172a',
            color: '#fff',
            borderRadius: '8px',
            fontSize: '11px',
            border: '1px solid #334155',
          }}
        />
        <Bar dataKey="principalMillion" name="principalMillion" stackId="a" fill="#10b981" />
        <Bar
          dataKey="interestMillion"
          name="interestMillion"
          stackId="a"
          fill="#f59e0b"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
