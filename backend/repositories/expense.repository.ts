import { getSupabase } from "../configs/supabase.js";

export type ExpenseInput = {
  name: string;
  category: string;
  expense_type: "one_time" | "subscription";
  amount_eur: number;
  frequency: "monthly" | "yearly" | null;
  first_charge_on: string;
  status: "active";
  notes: string | null;
};

export async function createExpense(expense: ExpenseInput) {
  const { data, error } = await getSupabase()
    .from("ec_expenses")
    .insert(expense)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Erro ao criar despesa: ${error?.message ?? "resposta vazia"}`,
    );
  }

  return data;
}

export async function getAllExpenses(): Promise<ExpenseInput[]> {
  const { data, error } = await getSupabase()
    .from("ec_expenses")
    .select("*");

  if (error || !data) {
    throw new Error(
      `Erro ao buscar despesas: ${error?.message ?? "resposta vazia"}`,
    );
  }

  return data;
}
