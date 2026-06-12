import Doctor
from "../../models/Doctor.js";

import DoctorPayout
from "../../models/DoctorPayout.js";

import { asyncHandler }
from "../../middleware/asyncHandler.js";

import Appointment
from "../../models/Appointment.js";

export const getDoctorEarnings =
asyncHandler(
async (req,res)=>{

const doctor =
await Doctor.findOne({
  userId:req.user._id
});

console.log("Doctor:", doctor);

const appointments =
await Appointment.find({
  doctorId: doctor._id,
  status: "completed",
});

const total =
appointments.reduce(
  (sum,item)=>
    sum +
    Number(item.fees || 0),
  0
);

res.json({
  success:true,
  data:{
    total,
    paid: total,
    pending:0,
    payouts:[]
  }
});

const paid =
payouts
.filter(
item =>
item.status==="paid"
)
.reduce(
(sum,item)=>
sum +
item.doctorAmount,
0
);

const pending =
payouts
.filter(
item =>
item.status==="pending"
)
.reduce(
(sum,item)=>
sum +
item.doctorAmount,
0
);

res.json({
success:true,
data:{
total,
paid,
pending,
payouts,
},
});

});