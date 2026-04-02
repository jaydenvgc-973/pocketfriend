import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all school locations
    const locations = await base44.entities.LocationReference.filter({
      created_by: user.email
    });

    const schools = locations.filter(loc => 
      ['education', 'school'].includes(loc.category) && 
      loc.enrolled_students?.length > 0
    );

    const results = [];
    const today = new Date();

    for (const school of schools) {
      for (const student of school.enrolled_students || []) {
        if (student.status !== 'active' || student.scholarship_enabled) {
          continue; // Skip inactive or scholarship students
        }

        // Get character financial record
        const financials = await base44.entities.CharacterFinancial.filter({
          character_id: student.character_id
        });

        let financial = financials[0];
        if (!financial) {
          financial = await base44.entities.CharacterFinancial.create({
            character_id: student.character_id,
            character_name: student.character_name,
            current_balance: 6000,
            total_income: 0,
            total_expenses: 0,
            recurring_expenses: []
          });
        }

        // Calculate payment based on frequency
        let tuitionAmount = student.tuition_amount || 0;
        if (!tuitionAmount && school.tuition_cost) {
          tuitionAmount = school.tuition_cost;
          if (school.tuition_frequency === 'annual') {
            tuitionAmount = tuitionAmount / 12; // Monthly equivalent
          } else if (school.tuition_frequency === 'semester') {
            tuitionAmount = tuitionAmount / 6; // Monthly equivalent
          }
        }

        if (tuitionAmount <= 0) continue;

        const newBalance = financial.current_balance - tuitionAmount;
        const newTotalExpenses = financial.total_expenses + tuitionAmount;

        // Update or add tuition expense
        const expenses = financial.recurring_expenses || [];
        const tuitionExpenseIdx = expenses.findIndex(
          e => e.expense_type === 'tuition' && e.location_id === school.id
        );

        let updatedExpenses;
        if (tuitionExpenseIdx >= 0) {
          // Update existing
          updatedExpenses = [...expenses];
          updatedExpenses[tuitionExpenseIdx] = {
            ...updatedExpenses[tuitionExpenseIdx],
            monthly_cost: tuitionAmount,
            total_paid: (updatedExpenses[tuitionExpenseIdx].total_paid || 0) + tuitionAmount,
            last_payment_date: today.toISOString()
          };
        } else {
          // Add new
          updatedExpenses = [
            ...expenses,
            {
              expense_type: 'tuition',
              location_id: school.id,
              location_name: school.name,
              description: `Tuition - ${school.name}`,
              monthly_cost: tuitionAmount,
              total_paid: tuitionAmount,
              last_payment_date: today.toISOString()
            }
          ];
        }

        await base44.entities.CharacterFinancial.update(financial.id, {
          current_balance: newBalance,
          total_expenses: newTotalExpenses,
          recurring_expenses: updatedExpenses
        });

        results.push({
          character_id: student.character_id,
          character_name: student.character_name,
          school: school.name,
          amount: tuitionAmount,
          new_balance: newBalance,
          scholarship: student.scholarship_enabled,
          status: 'processed'
        });
      }
    }

    return Response.json({
      success: true,
      tuition_charged: results,
      processed: results.length,
      timestamp: today.toISOString()
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});