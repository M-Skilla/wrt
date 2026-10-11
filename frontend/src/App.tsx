import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/Shell';
import { EmptyState, LinkButton, Loading } from './components/ui';
import { LedgerStreamProvider } from './lib/events';
import { homeFor, useIdentity } from './lib/identity';
import { DisputeDetail } from './views/detail/DisputeDetail';
import { LoanDetail } from './views/detail/LoanDetail';
import { ReceiptDetail } from './views/detail/ReceiptDetail';
import { FarmerLoans } from './views/farmer/FarmerLoans';
import { FarmerReceipts } from './views/farmer/FarmerReceipts';
import { InspectionForm } from './views/inspector/InspectionForm';
import { InspectorHistory } from './views/inspector/InspectorHistory';
import { InspectorQueue } from './views/inspector/InspectorQueue';
import { LenderCollateral } from './views/lender/LenderCollateral';
import { LenderDisputes } from './views/lender/LenderDisputes';
import { LenderLoans } from './views/lender/LenderLoans';
import { LenderPortfolio } from './views/lender/LenderPortfolio';
import { Main } from './views/Main';
import { RegulatorDisputes } from './views/regulator/RegulatorDisputes';
import { RegulatorExplorer } from './views/regulator/RegulatorExplorer';
import { RegulatorOverview } from './views/regulator/RegulatorOverview';
import { RegulatorRegistry } from './views/regulator/RegulatorRegistry';
import { RegulatorSettings } from './views/regulator/RegulatorSettings';
import { RegulatorWrrb } from './views/regulator/RegulatorWrrb';
import { WarehouseDeposits } from './views/warehouse/WarehouseDeposits';
import { WarehouseFarmers } from './views/warehouse/WarehouseFarmers';
import { WarehouseOverview } from './views/warehouse/WarehouseOverview';
import { WarehouseReceipts } from './views/warehouse/WarehouseReceipts';
import { WarehouseRecordDeposit } from './views/warehouse/WarehouseRecordDeposit';
import { WarehouseWithdrawals } from './views/warehouse/WarehouseWithdrawals';

/** Pages behind a demo identity, optionally limited to one role (the chaincode enforces access either way). */
function Gate({ role, children }: { role?: string; children: ReactNode }) {
  const { label, me, loading } = useIdentity();
  const location = useLocation();
  if (!label) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (loading || !me) {
    return (
      <AppShell>
        <Loading what="loading identity" />
      </AppShell>
    );
  }
  if (role && me.chaincodeView.role !== role) {
    return (
      <AppShell>
        <EmptyState title="Not available for this identity" action={<LinkButton to={homeFor(me.chaincodeView.role)}>Go to my home</LinkButton>}>
          This page is for {role}. You are signed in as {me.chaincodeView.role ?? 'an identity with no role'}.
        </EmptyState>
      </AppShell>
    );
  }
  return <AppShell>{children}</AppShell>;
}

export function App() {
  return (
    <LedgerStreamProvider>
      <AppRoutes />
    </LedgerStreamProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Main />} />
      <Route path="/receipts/:id" element={<Gate><ReceiptDetail /></Gate>} />
      <Route path="/loans/:id" element={<Gate><LoanDetail /></Gate>} />
      <Route path="/disputes/:id" element={<Gate><DisputeDetail /></Gate>} />

      <Route path="/warehouse" element={<Gate role="warehouse_operator"><WarehouseOverview /></Gate>} />
      <Route path="/warehouse/farmers" element={<Gate role="warehouse_operator"><WarehouseFarmers /></Gate>} />
      <Route path="/warehouse/deposits/new" element={<Gate role="warehouse_operator"><WarehouseRecordDeposit /></Gate>} />
      <Route path="/warehouse/deposits" element={<Gate role="warehouse_operator"><WarehouseDeposits /></Gate>} />
      <Route path="/warehouse/receipts" element={<Gate role="warehouse_operator"><WarehouseReceipts /></Gate>} />
      <Route path="/warehouse/withdrawals" element={<Gate role="warehouse_operator"><WarehouseWithdrawals /></Gate>} />

      <Route path="/farmer" element={<Gate role="farmer"><FarmerReceipts /></Gate>} />
      <Route path="/farmer/loans" element={<Gate role="farmer"><FarmerLoans /></Gate>} />

      <Route path="/lender" element={<Gate role="lender_officer"><LenderPortfolio /></Gate>} />
      <Route path="/lender/collateral" element={<Gate role="lender_officer"><LenderCollateral /></Gate>} />
      <Route path="/lender/loans" element={<Gate role="lender_officer"><LenderLoans /></Gate>} />
      <Route path="/lender/disputes" element={<Gate role="lender_officer"><LenderDisputes /></Gate>} />

      <Route path="/inspector" element={<Gate role="inspector"><InspectorQueue /></Gate>} />
      <Route path="/inspector/inspect" element={<Gate role="inspector"><InspectionForm /></Gate>} />
      <Route path="/inspector/inspect/:subjectId" element={<Gate role="inspector"><InspectionForm /></Gate>} />
      <Route path="/inspector/history" element={<Gate role="inspector"><InspectorHistory /></Gate>} />

      <Route path="/regulator" element={<Gate role="regulator_officer"><RegulatorOverview /></Gate>} />
      <Route path="/regulator/registry" element={<Gate role="regulator_officer"><RegulatorRegistry /></Gate>} />
      <Route path="/regulator/wrrb" element={<Gate role="regulator_officer"><RegulatorWrrb /></Gate>} />
      <Route path="/regulator/disputes" element={<Gate role="regulator_officer"><RegulatorDisputes /></Gate>} />
      <Route path="/regulator/settings" element={<Gate role="regulator_officer"><RegulatorSettings /></Gate>} />
      <Route path="/regulator/explorer" element={<Gate><RegulatorExplorer /></Gate>} />

      <Route
        path="*"
        element={
          <Gate>
            <EmptyState title="Page not found" action={<LinkButton to="/">Home</LinkButton>}>
              There is no screen at this address.
            </EmptyState>
          </Gate>
        }
      />
    </Routes>
  );
}
