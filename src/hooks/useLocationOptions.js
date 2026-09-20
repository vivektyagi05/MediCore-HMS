import { useEffect, useState } from "react";
import { masterDataApi } from "../api/masterDataApi";

// Loads canonical states once and the districts of the selected state.
// Latest selection always wins: a response for a previous state is discarded
// (effect cleanup) and can never populate the list for the current one.
export function useLocationOptions(stateMasterId) {
  const [states, setStates] = useState({ items: [], loading: true, error: false });
  const [districts, setDistricts] = useState({ forId: "", items: [], loading: false, error: false });

  useEffect(() => {
    let active = true;
    masterDataApi.getStates()
      .then((items) => { if (active) setStates({ items: Array.isArray(items) ? items : [], loading: false, error: false }); })
      .catch(() => { if (active) setStates({ items: [], loading: false, error: true }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!stateMasterId) {
      setDistricts({ forId: "", items: [], loading: false, error: false });
      return undefined;
    }
    let active = true;
    setDistricts({ forId: stateMasterId, items: [], loading: true, error: false });
    masterDataApi.getDistricts(stateMasterId)
      .then((items) => { if (active) setDistricts({ forId: stateMasterId, items: Array.isArray(items) ? items : [], loading: false, error: false }); })
      .catch(() => { if (active) setDistricts({ forId: stateMasterId, items: [], loading: false, error: true }); });
    return () => { active = false; };
  }, [stateMasterId]);

  const districtsCurrent = districts.forId === (stateMasterId || "");
  return {
    states: states.items,
    statesLoading: states.loading,
    statesError: states.error,
    districts: districtsCurrent ? districts.items : [],
    districtsLoading: Boolean(stateMasterId) && (!districtsCurrent || districts.loading),
    districtsError: districtsCurrent && districts.error,
  };
}
