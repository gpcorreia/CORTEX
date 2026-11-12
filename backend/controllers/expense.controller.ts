import type { NextFunction, Request, Response } from "express";
import { createExpense,getAllExpenses } from "../repositories/expense.repository.js";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const cleanText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export async function handleExpenseCreation(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const name = cleanText(req.body?.name);
    const provider = cleanText(req.body?.provider);
    const category = cleanText(req.body?.category);
    const firstChargeOn = cleanText(req.body?.date);
    const type = req.body?.type === "subscription" ? "subscription" : "one_time";
    const amount = Number(req.body?.amount_eur);
    const frequency = type === "subscription"
      ? req.body?.frequency === "yearly"
        ? "yearly"
        : "monthly"
      : null;

    if (
      !name ||
      name.length > 100 ||
      !category ||
      category.length > 80 ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      !isoDate.test(firstChargeOn)
    ) {
      res.status(400).json({
        message: "Preenche corretamente os dados obrigatórios da despesa.",
      });
      return;
    }

    const expense = await createExpense({
      name,
      category,
      expense_type: type,
      amount_eur: amount,
      frequency,
      first_charge_on: firstChargeOn,
      status: "active",
      notes: provider ? `Fornecedor: ${provider}.` : null,
    });

    res.status(201).json({
      message: `Despesa ${name} criada com sucesso.`,
      expense,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleGetAllExpenses(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Implement the logic to retrieve all expenses from the database
    // For example, you might call a function like getAllExpenses() from your repository
    const expenses = await getAllExpenses(); // This function needs to be implemented in your repository

    res.status(200).json({
      message: "Despesas recuperadas com sucesso.",
      expenses,
    });
  } catch (error) {
    next(error);
  }
}
