import { useEffect, useState } from "react";
import { masterDataApi } from "../api/masterDataApi";

// Loads canonical states once, the districts of the selected state, and the
// cities of the selected district.
// Latest selection always wins at every level: a response for a previous
// state/district is discarded (effect cleanup) and can never populate the
// list for the current one.
export function useLocationOptions(stateMasterId, districtMasterId) {
  const [states, setStates] = useState({ items: [], loading: true, error: false });
  const [districts, setDistricts] = useState({ forId: "", items: [], loading: false, error: false });
  const [cities, setCities] = useState({ forId: "", items: [], loading: false, error: false });

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

  useEffect(() => {
    if (!districtMasterId) {
      setCities({ forId: "", items: [], loading: false, error: false });
      return undefined;
    }
    let active = true;
    setCities({ forId: districtMasterId, items: [], loading: true, error: false });
    masterDataApi.getCities(districtMasterId)
      .then((items) => { if (active) setCities({ forId: districtMasterId, items: Array.isArray(items) ? items : [], loading: false, error: false }); })
      .catch(() => { if (active) setCities({ forId: districtMasterId, items: [], loading: false, error: true }); });
    return () => { active = false; };
  }, [districtMasterId]);

  const districtsCurrent = districts.forId === (stateMasterId || "");
  const citiesCurrent = cities.forId === (districtMasterId || "");
  return {
    states: states.items,
    statesLoading: states.loading,
    statesError: states.error,
    districts: districtsCurrent ? districts.items : [],
    districtsLoading: Boolean(stateMasterId) && (!districtsCurrent || districts.loading),
    districtsError: districtsCurrent && districts.error,
    cities: citiesCurrent ? cities.items : [],
    citiesLoading: Boolean(districtMasterId) && (!citiesCurrent || cities.loading),
    citiesError: citiesCurrent && cities.error,
  };
}
