import { motion } from "framer-motion";
import Modal from "../ui/Modal";

function AdminModal({ isOpen, title, children, onClose }) {
  return (
    <Modal isOpen={isOpen} title={title} onClose={onClose}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
        {children}
      </motion.div>
    </Modal>
  );
}

export default AdminModal;
